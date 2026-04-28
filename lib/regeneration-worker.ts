import "server-only";

import { Client } from "pg";

import {
  defaultAnthropicCall,
  type AnthropicCallFn,
} from "@/lib/anthropic-call";
import { computeCostCents, PRICING_VERSION } from "@/lib/anthropic-pricing";
import {
  publishRegenJob,
  type PublishRegenResult,
  type WpRegenCallBundle,
} from "@/lib/regeneration-publisher";
import {
  buildSystemPromptForSite,
  type SiteIdentity,
} from "@/lib/system-prompt";

// Exposed so tests can stub the prompt builder to assert the
// DS_ARCHIVED failure branch without relying on flaky file-system
// state. Default is the real builder; production callers omit the
// option.
export type BuildSystemPromptFn = (site: SiteIdentity) => Promise<string>;
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// M7-2 — Single-page re-generation worker core.
//
// Mirrors the M3 batch worker's concurrency primitives (lease /
// heartbeat / reaper over FOR UPDATE SKIP LOCKED) but scoped to
// regeneration_jobs, which is always single-slot — one job per page.
//
// M7-2 ships the skeleton + real Anthropic integration + event-log
// writes. Quality gates and WP update are dummied out (always-pass
// gates + no-op WP) so the worker walks its state machine without
// live calls. M7-3 swaps both stubs for real implementations.
//
// Runtime: nodejs. All primitives accept an optional pg.Client so
// concurrency tests can supply isolated clients; in production the
// cron entrypoint opens one client per tick.
// ---------------------------------------------------------------------------

export const DEFAULT_REGEN_LEASE_MS = 180_000;
export const DEFAULT_REGEN_HEARTBEAT_MS = 30_000;

// The same retry budget the batch worker uses. A 3rd failure exits
// terminal. M7-5 layers retry_after backoff on top.
export const REGEN_RETRY_MAX_ATTEMPTS = 3;

// Indexed by the `attempts` value AT THE TIME OF FAILURE. 1st attempt
// failed → wait 1s before re-lease; 2nd → wait 5s. A 3rd failure exits
// terminal per the cap above. Matches the batch worker's RETRY_BACKOFF_MS.
export const REGEN_RETRY_BACKOFF_MS: Record<number, number> = {
  1: 1_000,
  2: 5_000,
};

export type LeasedRegenJob = {
  id: string;
  site_id: string;
  page_id: string;
  expected_page_version: number;
  attempts: number;
  anthropic_idempotency_key: string;
  wp_idempotency_key: string;
};

export type ReaperResult = { reapedCount: number };

function requireDbUrl(): string {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      "SUPABASE_DB_URL is not set. Required by the regeneration worker.",
    );
  }
  return url;
}

async function withClient<T>(
  provided: Client | null,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  if (provided) return fn(provided);
  const c = new Client({ connectionString: requireDbUrl() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/**
 * Lease the oldest pending (or expired-leased) regen job for this worker.
 * Returns null when nothing is leasable.
 */
export async function leaseNextRegenJob(
  workerId: string,
  opts: { leaseDurationMs?: number; client?: Client | null } = {},
): Promise<LeasedRegenJob | null> {
  const lease = opts.leaseDurationMs ?? DEFAULT_REGEN_LEASE_MS;
  return withClient(opts.client ?? null, async (c) => {
    try {
      await c.query("BEGIN");

      const candidate = await c.query<{ id: string }>(
        `
        SELECT id
          FROM regeneration_jobs
         WHERE (
                 (
                   status = 'pending'
                   AND (retry_after IS NULL OR retry_after < now())
                 )
                 OR (
                   status = 'running'
                   AND lease_expires_at IS NOT NULL
                   AND lease_expires_at < now()
                 )
               )
           AND cancel_requested_at IS NULL
         ORDER BY created_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED
        `,
      );
      if (candidate.rows.length === 0) {
        await c.query("COMMIT");
        return null;
      }
      const jobId = candidate.rows[0]!.id;

      const leased = await c.query<{
        id: string;
        site_id: string;
        page_id: string;
        expected_page_version: number;
        attempts: number;
        anthropic_idempotency_key: string;
        wp_idempotency_key: string;
      }>(
        `
        UPDATE regeneration_jobs
           SET status = 'running',
               worker_id = $2,
               lease_expires_at = now() + ($3 || ' milliseconds')::interval,
               last_heartbeat_at = now(),
               attempts = attempts + 1,
               started_at = COALESCE(started_at, now()),
               updated_at = now()
         WHERE id = $1
         RETURNING id, site_id, page_id, expected_page_version, attempts,
                   anthropic_idempotency_key, wp_idempotency_key
        `,
        [jobId, workerId, String(lease)],
      );

      await c.query("COMMIT");
      const row = leased.rows[0]!;
      return {
        id: row.id,
        site_id: row.site_id,
        page_id: row.page_id,
        expected_page_version: row.expected_page_version,
        attempts: row.attempts,
        anthropic_idempotency_key: row.anthropic_idempotency_key,
        wp_idempotency_key: row.wp_idempotency_key,
      };
    } catch (err) {
      try {
        await c.query("ROLLBACK");
      } catch {
        // swallow
      }
      throw err;
    }
  });
}

/**
 * Extend the lease on `jobId` iff this worker still owns it.
 */
export async function heartbeatRegen(
  jobId: string,
  workerId: string,
  opts: { leaseDurationMs?: number; client?: Client | null } = {},
): Promise<boolean> {
  const lease = opts.leaseDurationMs ?? DEFAULT_REGEN_LEASE_MS;
  return withClient(opts.client ?? null, async (c) => {
    const res = await c.query(
      `
      UPDATE regeneration_jobs
         SET lease_expires_at = now() + ($3 || ' milliseconds')::interval,
             last_heartbeat_at = now(),
             updated_at = now()
       WHERE id = $1
         AND worker_id = $2
         AND status = 'running'
      `,
      [jobId, workerId, String(lease)],
    );
    return (res.rowCount ?? 0) > 0;
  });
}

/**
 * Reset any running job whose lease has expired back to 'pending' so
 * the next lease attempt can pick it up. Uses FOR UPDATE SKIP LOCKED
 * so two reapers racing don't double-reset.
 *
 * NOTE: resetting to 'pending' must also clear worker_id and
 * lease_expires_at to satisfy the M7-1 lease-coherence CHECK.
 */
export async function reapExpiredRegenLeases(
  opts: { client?: Client | null } = {},
): Promise<ReaperResult> {
  return withClient(opts.client ?? null, async (c) => {
    try {
      await c.query("BEGIN");
      const expired = await c.query<{ id: string }>(
        `
        SELECT id
          FROM regeneration_jobs
         WHERE status = 'running'
           AND lease_expires_at IS NOT NULL
           AND lease_expires_at < now()
         FOR UPDATE SKIP LOCKED
        `,
      );
      if (expired.rows.length === 0) {
        await c.query("COMMIT");
        return { reapedCount: 0 };
      }
      const ids = expired.rows.map((r) => r.id);
      const reset = await c.query(
        `
        UPDATE regeneration_jobs
           SET status = 'pending',
               worker_id = NULL,
               lease_expires_at = NULL,
               updated_at = now()
         WHERE id = ANY($1::uuid[])
        `,
        [ids],
      );
      await c.query("COMMIT");
      return { reapedCount: reset.rowCount ?? 0 };
    } catch (err) {
      try {
        await c.query("ROLLBACK");
      } catch {
        // swallow
      }
      throw err;
    }
  });
}

// ---------------------------------------------------------------------------
// Anthropic stage
// ---------------------------------------------------------------------------

const REGEN_MODEL = "claude-opus-4-7";
const REGEN_MAX_TOKENS = 8_000;

export type ProcessRegenResult =
  | { ok: true; generated_html: string }
  | {
      ok: false;
      code:
        | "DS_ARCHIVED"
        | "ANTHROPIC_FAILURE"
        | "VERSION_CONFLICT"
        | "CANCELLED"
        | "INTERNAL_ERROR";
      message: string;
      retryable: boolean;
    };

/**
 * Run the Anthropic stage for a leased regen job. Writes an
 * `anthropic_response_received` event BEFORE the cost columns flip,
 * so billing reconciliation is always possible from the event log.
 *
 * Returns the new HTML on success. The caller (M7-3) then runs
 * quality gates + WP update. In M7-2 we advance straight to
 * `succeeded` with the HTML stored only in the event log — nothing
 * commits to pages.generated_html yet.
 */
export async function processRegenJobAnthropic(
  jobId: string,
  opts: {
    anthropicCall?: AnthropicCallFn;
    buildSystemPrompt?: BuildSystemPromptFn;
    client?: Client | null;
  } = {},
): Promise<ProcessRegenResult> {
  const supabase = getServiceRoleClient();
  const anthropicCall = opts.anthropicCall ?? defaultAnthropicCall;
  const buildSystemPrompt =
    opts.buildSystemPrompt ?? buildSystemPromptForSite;

  // Load the job + page + site context.
  const jobRes = await supabase
    .from("regeneration_jobs")
    .select(
      "id, site_id, page_id, expected_page_version, anthropic_idempotency_key, status, cancel_requested_at",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (jobRes.error || !jobRes.data) {
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: `regeneration_jobs lookup failed: ${jobRes.error?.message ?? "no row"}`,
      retryable: false,
    };
  }
  if (jobRes.data.cancel_requested_at) {
    return {
      ok: false,
      code: "CANCELLED",
      message: "Job was cancelled before Anthropic stage ran.",
      retryable: false,
    };
  }

  const pageRes = await supabase
    .from("pages")
    .select(
      "id, site_id, slug, title, page_type, content_brief, design_system_version, version_lock",
    )
    .eq("id", jobRes.data.page_id)
    .maybeSingle();
  if (pageRes.error || !pageRes.data) {
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: `page lookup failed: ${pageRes.error?.message ?? "no row"}`,
      retryable: false,
    };
  }

  // If the caller's metadata snapshot is stale, the commit in M7-3
  // would fail VERSION_CONFLICT anyway — short-circuit before
  // spending Anthropic tokens.
  if (pageRes.data.version_lock !== jobRes.data.expected_page_version) {
    await recordTerminalFailure(supabase, jobId, {
      status: "failed",
      failure_code: "VERSION_CONFLICT",
      failure_detail: `page.version_lock = ${pageRes.data.version_lock}; job expected ${jobRes.data.expected_page_version}.`,
    });
    return {
      ok: false,
      code: "VERSION_CONFLICT",
      message:
        "Page metadata was edited after this regen was enqueued. Retry the regen.",
      retryable: false,
    };
  }

  const siteRes = await supabase
    .from("sites")
    .select("id, name, prefix, wp_url, status")
    .eq("id", jobRes.data.site_id)
    .maybeSingle();
  if (siteRes.error || !siteRes.data) {
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: `site lookup failed: ${siteRes.error?.message ?? "no row"}`,
      retryable: false,
    };
  }

  // Build the system prompt against the active design system. If the
  // page's recorded DS version has been archived, fail loud.
  let systemPrompt: string;
  try {
    systemPrompt = await buildSystemPrompt({
      id: siteRes.data.id as string,
      site_name: siteRes.data.name as string,
      prefix: siteRes.data.prefix as string,
      design_system_version: String(pageRes.data.design_system_version ?? 1),
    });
  } catch (err) {
    await recordTerminalFailure(supabase, jobId, {
      status: "failed",
      failure_code: "DS_ARCHIVED",
      failure_detail: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      code: "DS_ARCHIVED",
      message: "Design system context could not be loaded.",
      retryable: false,
    };
  }

  const brief = pageRes.data.content_brief ?? {};
  const userMessage = buildRegenUserMessage(
    pageRes.data.title as string,
    pageRes.data.slug as string,
    pageRes.data.page_type as string,
    brief,
  );

  // Fire Anthropic with the stored idempotency key. Retries reuse it
  // so the cached response comes back billed once.
  let response;
  try {
    response = await anthropicCall({
      model: REGEN_MODEL,
      max_tokens: REGEN_MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      idempotency_key: jobRes.data.anthropic_idempotency_key as string,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Let the worker decide retry vs terminal via attempts cap.
    return {
      ok: false,
      code: "ANTHROPIC_FAILURE",
      message,
      retryable: true,
    };
  }

  const inputTokens = response.usage.input_tokens ?? 0;
  const outputTokens = response.usage.output_tokens ?? 0;
  const cacheCreation = response.usage.cache_creation_input_tokens ?? 0;
  const cacheRead = response.usage.cache_read_input_tokens ?? 0;
  const cachedTokens = cacheRead + cacheCreation;
  const { cents: costCents } = computeCostCents(response.model, {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_creation_input_tokens: cacheCreation,
    cache_read_input_tokens: cacheRead,
  });

  // Event-log-first: write the event BEFORE the job columns flip.
  const eventInsert = await supabase.from("regeneration_events").insert({
    regeneration_job_id: jobId,
    type: "anthropic_response_received",
    payload: {
      response_id: response.id,
      model: response.model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cached_tokens: cachedTokens,
      cost_usd_cents: costCents,
      pricing_version: PRICING_VERSION,
    },
  });
  if (eventInsert.error) {
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: `event log write failed: ${eventInsert.error.message}`,
      retryable: true,
    };
  }

  // Now flip the cost columns. Idempotent on the event log: if this
  // fails and we retry, the event already exists (no double-billing
  // in reporting); the column UPDATE is re-playable.
  const costUpdate = await supabase
    .from("regeneration_jobs")
    .update({
      cost_usd_cents: costCents,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cached_tokens: cachedTokens,
      anthropic_raw_response_id: response.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  if (costUpdate.error) {
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: `cost update failed: ${costUpdate.error.message}`,
      retryable: true,
    };
  }

  const html = extractHtml(response.content);
  if (!html) {
    await recordTerminalFailure(supabase, jobId, {
      status: "failed",
      failure_code: "ANTHROPIC_EMPTY",
      failure_detail: "Anthropic response had no text content.",
    });
    return {
      ok: false,
      code: "ANTHROPIC_FAILURE",
      message: "Anthropic returned no text content.",
      retryable: false,
    };
  }

  // M7-2 left the job in 'running' here and the M7-3 publisher takes
  // over from this point: quality gates → image transfer → WP PUT →
  // commit to pages.generated_html → terminal 'succeeded'. Tests that
  // want to exercise only the Anthropic stage call processRegenJobAnthropic
  // directly; production runs go through processRegenJob which chains
  // both halves.
  return { ok: true, generated_html: html };
}

// ---------------------------------------------------------------------------
// Orchestrator — chains Anthropic + Publisher (M7-2 + M7-3)
// ---------------------------------------------------------------------------

export type ProcessRegenJobResult =
  | {
      ok: true;
      generated_html: string;
      publish: PublishRegenResult;
    }
  | {
      ok: false;
      stage: "anthropic" | "publish";
      code: string;
      message: string;
      retryable: boolean;
    };

/**
 * Full pipeline for a leased regen job. Runs the Anthropic stage,
 * then hands the generated HTML to the M7-3 publisher.
 *
 * On retryable failures where attempts < REGEN_RETRY_MAX_ATTEMPTS,
 * the job is reset to 'pending' with retry_after set to the backoff
 * window. leaseNextRegenJob's candidate query excludes pending rows
 * with retry_after in the future, so the job sits idle until its
 * backoff expires. When attempts hits the cap OR the failure is
 * non-retryable, the job is already in a terminal state (the inner
 * stage records it) or gets terminal-failed here as a safety net.
 */
export async function processRegenJob(
  jobId: string,
  opts: {
    anthropicCall?: AnthropicCallFn;
    wp: WpRegenCallBundle;
  },
): Promise<ProcessRegenJobResult> {
  const anthropic = await processRegenJobAnthropic(jobId, {
    anthropicCall: opts.anthropicCall,
  });
  if (!anthropic.ok) {
    await handleRetryOrTerminal(jobId, {
      code: anthropic.code,
      message: anthropic.message,
      retryable: anthropic.retryable,
    });
    return {
      ok: false,
      stage: "anthropic",
      code: anthropic.code,
      message: anthropic.message,
      retryable: anthropic.retryable,
    };
  }
  const publish = await publishRegenJob(jobId, anthropic.generated_html, opts.wp);
  if (!publish.ok) {
    await handleRetryOrTerminal(jobId, {
      code: publish.code,
      message: publish.message,
      retryable: publish.retryable,
    });
    return {
      ok: false,
      stage: "publish",
      code: publish.code,
      message: publish.message,
      retryable: publish.retryable,
    };
  }
  return {
    ok: true,
    generated_html: anthropic.generated_html,
    publish,
  };
}

/**
 * Shared retry / terminal-fail handler. Called after either stage
 * returns a non-ok result. Reads the job's current state:
 *   - If the inner stage already set a terminal status
 *     (failed / failed_gates / cancelled), we do nothing — the
 *     inner stage already recorded the reason.
 *   - If the job is still 'running' AND the failure is retryable
 *     AND attempts < cap, defer to pending with retry_after.
 *   - Otherwise, terminal-fail + release the lease.
 */
async function handleRetryOrTerminal(
  jobId: string,
  failure: { code: string; message: string; retryable: boolean },
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("regeneration_jobs")
    .select("status, attempts")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !data) return;
  if (data.status !== "running") {
    // Inner stage already terminalled (or the job was cancelled /
    // completed). Nothing to do.
    return;
  }

  const attempts = Number(data.attempts ?? 0);
  const shouldRetry =
    failure.retryable && attempts < REGEN_RETRY_MAX_ATTEMPTS;

  if (shouldRetry) {
    const backoffMs = REGEN_RETRY_BACKOFF_MS[attempts] ?? 30_000;
    await supabase
      .from("regeneration_jobs")
      .update({
        status: "pending",
        worker_id: null,
        lease_expires_at: null,
        retry_after: new Date(Date.now() + backoffMs).toISOString(),
        failure_code: failure.code,
        failure_detail: failure.message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    await supabase.from("regeneration_events").insert({
      regeneration_job_id: jobId,
      type: "retry_scheduled",
      payload: {
        attempts,
        backoff_ms: backoffMs,
        code: failure.code,
        message: failure.message,
      },
    });
    return;
  }

  // Terminal: cap reached or non-retryable. Keep whatever status the
  // inner stage may have set; otherwise mark failed.
  await supabase
    .from("regeneration_jobs")
    .update({
      status: "failed",
      worker_id: null,
      lease_expires_at: null,
      failure_code: failure.code,
      failure_detail: failure.message,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  await supabase.from("regeneration_events").insert({
    regeneration_job_id: jobId,
    type: "terminal_failure",
    payload: {
      attempts,
      code: failure.code,
      message: failure.message,
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRegenUserMessage(
  title: string,
  slug: string,
  pageType: string,
  brief: unknown,
): string {
  // Path B (PB-5, 2026-04-29): emit a contiguous fragment of top-level
  // <section data-opollo …> elements. The host WP theme owns chrome
  // (DOCTYPE/html/head/body/nav/header/footer) and visual tokens
  // (palette, fonts, spacing). See docs/INTEGRATION_MODEL_DECISION.md.
  const briefJson = JSON.stringify(brief ?? {}, null, 2);
  return [
    `Re-generate the page "${title}" (slug: ${slug}, type: ${pageType}) against the current design system.`,
    "",
    "Content brief (from the original generation):",
    "",
    "```json",
    briefJson,
    "```",
    "",
    "OUTPUT FORMAT — STRICT REQUIREMENTS:",
    "1. Output a CONTIGUOUS FRAGMENT of one or more top-level <section> elements. Do NOT emit any of: <!DOCTYPE>, <html>, <head>, <body>, <nav>, <header>, <footer>, <meta>, <link>, <title>, <script>. The host WP theme owns those.",
    "2. Every top-level <section> MUST carry the data-opollo attribute (presence-only, no value required). The first top-level <section> MUST also carry data-ds-version=\"<DS version from system prompt>\".",
    "3. Every CSS class must start with the site prefix (per the system prompt).",
    "4. Inline <style> blocks are permitted ONLY for animation keyframes / scoped utility rules under 200 chars total.",
    "5. Output raw HTML only. No markdown code fences.",
  ].join("\n");
}

function extractHtml(
  content: Array<{ type: "text"; text: string }>,
): string | null {
  for (const block of content) {
    if (block.type === "text" && block.text.trim().length > 0) {
      return block.text;
    }
  }
  return null;
}

async function recordTerminalFailure(
  supabase: ReturnType<typeof getServiceRoleClient>,
  jobId: string,
  opts: {
    status: "failed" | "failed_gates";
    failure_code: string;
    failure_detail: string;
  },
): Promise<void> {
  await supabase.from("regeneration_events").insert({
    regeneration_job_id: jobId,
    type: "terminal_failure",
    payload: {
      failure_code: opts.failure_code,
      failure_detail: opts.failure_detail,
    },
  });
  await supabase
    .from("regeneration_jobs")
    .update({
      status: opts.status,
      failure_code: opts.failure_code,
      failure_detail: opts.failure_detail,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      worker_id: null,
      lease_expires_at: null,
    })
    .eq("id", jobId);
}
