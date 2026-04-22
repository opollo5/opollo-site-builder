import "server-only";

import { Client } from "pg";

import {
  extractCloudflareIds,
  rewriteImageUrls,
} from "@/lib/html-image-rewrite";
import { LEADSOURCE_FONT_LOAD_HTML } from "@/lib/leadsource-fonts";
import { runGates, type RunGatesResult } from "@/lib/quality-gates";
import { getServiceRoleClient } from "@/lib/supabase";
import {
  PROJECTED_COST_PER_REGEN_CENTS,
  reserveBudget,
} from "@/lib/tenant-budgets";
import {
  transferImagesForPage,
  type WpMediaCallBundle,
} from "@/lib/wp-media-transfer";

// ---------------------------------------------------------------------------
// M7-3 — Re-generation publisher.
//
// Picks up from the Anthropic stage (M7-2's processRegenJobAnthropic,
// which leaves the job 'running' with the new HTML in its return
// value) and drives the full publish pipeline:
//
//   1. Quality gates (runGates from M3-5) — fail closed on any fail.
//      Terminal 'failed_gates' with the structured payload so the UI
//      can render the specific gate that rejected the HTML.
//
//   2. Partial-commit recovery. If a prior attempt wrote
//      `wp_put_succeeded` to the event log but failed before the
//      pages commit, we adopt the event's payload (final HTML +
//      resulting slug) and skip the WP side entirely. No double PUT,
//      no image re-transfer.
//
//   3. GET the current WP page by wp_page_id. Compare WP's slug to
//      our pages.slug to detect drift (M6-3 created this case: operator
//      edited pages.slug in our DB; WP still has the old post_name).
//
//   4. Image transfer for any new Cloudflare URLs in the HTML (M4-7
//      path — reused verbatim; existing image_usage rows mean
//      re-transfers short-circuit to adoption).
//
//   5. WP PUT. Body includes `slug` iff drift was detected, so WP
//      renames post_name atomically. WP returns the resulting slug
//      (which may differ if WP sanitised it — e.g. capitalised into
//      lowercase).
//
//   6. Event log: write `wp_put_succeeded` with final HTML bytes +
//      resulting slug BEFORE the pages UPDATE. If the UPDATE fails
//      for a transient reason, the retry adopts this event instead
//      of re-running step 5.
//
//   7. pages UPDATE with optimistic lock on version_lock. Mismatch
//      (an M6-3 metadata edit landed between enqueue and now) →
//      terminal 'failed' with VERSION_CONFLICT. Operator retries —
//      the new regen job snapshots the new version and the
//      wp_put_succeeded event from this attempt is harmless (it
//      lives on the now-failed job).
//
//   8. Event log: `pages_committed`. Flip regeneration_jobs.status
//      to 'succeeded' and release the lease.
//
// The pipeline short-circuits on any failure — each step's result is
// structured so the caller (processRegenJob in regeneration-worker)
// can decide retry vs terminal based on the `retryable` flag. WP PUT
// uses the stored wp_idempotency_key header so WP-side double-billing
// is impossible across retries.
// ---------------------------------------------------------------------------

export type WpGetByIdFound = {
  wp_page_id: number;
  slug: string;
  title: string;
  status: string;
  modified: string;
};

export type WpGetByIdResult =
  | { ok: true; found: WpGetByIdFound | null }
  | {
      ok: false;
      code: "WP_API_ERROR" | "AUTH_FAILED" | "NETWORK_ERROR";
      message: string;
      retryable: boolean;
    };

export type WpUpdateByIdResult =
  | { ok: true; wp_page_id: number; resulting_slug: string }
  | {
      ok: false;
      code: "WP_API_ERROR" | "AUTH_FAILED" | "NETWORK_ERROR";
      message: string;
      retryable: boolean;
    };

export type WpRegenCallBundle = {
  getByWpPageId: (wp_page_id: number) => Promise<WpGetByIdResult>;
  updateByWpPageId: (input: {
    wp_page_id: number;
    content: string;
    slug?: string;
    title?: string;
    idempotency_key: string;
  }) => Promise<WpUpdateByIdResult>;
  media?: WpMediaCallBundle;
  cloudflareUrlFor?: (cloudflareId: string) => string;
};

export type PublishRegenSuccess = {
  ok: true;
  wp_page_id: number;
  resulting_slug: string;
  drift_detected: boolean;
  adopted_from_event: boolean;
  final_html: string;
};

export type PublishRegenFailureCode =
  | "GATES_FAILED"
  | "WP_GET_FAILED"
  | "WP_PUT_FAILED"
  | "IMAGE_TRANSFER_FAILED"
  | "VERSION_CONFLICT"
  | "DS_ARCHIVED"
  | "INTERNAL_ERROR";

export type PublishRegenFailure = {
  ok: false;
  code: PublishRegenFailureCode;
  message: string;
  retryable: boolean;
  gate_failures?: RunGatesResult;
};

export type PublishRegenResult = PublishRegenSuccess | PublishRegenFailure;

export async function publishRegenJob(
  jobId: string,
  generatedHtml: string,
  wp: WpRegenCallBundle,
): Promise<PublishRegenResult> {
  try {
    return await publishRegenJobImpl(jobId, generatedHtml, wp);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: `Unhandled error in publishRegenJob: ${message}`,
      retryable: true,
    };
  }
}

async function publishRegenJobImpl(
  jobId: string,
  generatedHtml: string,
  wp: WpRegenCallBundle,
): Promise<PublishRegenResult> {
  const supabase = getServiceRoleClient();

  // Load job + companion rows.
  const jobRes = await supabase
    .from("regeneration_jobs")
    .select(
      "id, site_id, page_id, expected_page_version, wp_idempotency_key, status",
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
  const job = jobRes.data;

  const pageRes = await supabase
    .from("pages")
    .select(
      "id, slug, title, page_type, wp_page_id, version_lock, design_system_version",
    )
    .eq("id", job.page_id)
    .maybeSingle();
  if (pageRes.error || !pageRes.data) {
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: `page lookup failed: ${pageRes.error?.message ?? "no row"}`,
      retryable: false,
    };
  }
  const page = pageRes.data;

  const siteRes = await supabase
    .from("sites")
    .select("id, prefix, wp_url")
    .eq("id", job.site_id)
    .maybeSingle();
  if (siteRes.error || !siteRes.data) {
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: `site lookup failed: ${siteRes.error?.message ?? "no row"}`,
      retryable: false,
    };
  }
  const site = siteRes.data;

  // Load prior events for idempotent replay.
  const eventsRes = await supabase
    .from("regeneration_events")
    .select("type, payload")
    .eq("regeneration_job_id", jobId);
  if (eventsRes.error) {
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: `event log lookup failed: ${eventsRes.error.message}`,
      retryable: true,
    };
  }
  const priorEvents = eventsRes.data ?? [];

  // If pages was already committed in a prior attempt (e.g. worker
  // crashed between pages_committed and regen_jobs status flip), just
  // finalise the job.
  const pagesCommittedEvent = priorEvents.find(
    (e) => e.type === "pages_committed",
  );
  if (pagesCommittedEvent) {
    await finaliseRegenJob(supabase, jobId);
    const priorPut = priorEvents.find((e) => e.type === "wp_put_succeeded");
    const priorPutPayload = (priorPut?.payload ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      wp_page_id: (priorPutPayload.wp_page_id as number) ?? page.wp_page_id,
      resulting_slug:
        (priorPutPayload.resulting_slug as string) ?? (page.slug as string),
      drift_detected: Boolean(priorPutPayload.drift_detected),
      adopted_from_event: true,
      final_html: generatedHtml,
    };
  }

  // 1. Quality gates
  const gates = runGates({
    html: generatedHtml,
    slug: page.slug as string,
    prefix: site.prefix as string,
    design_system_version: String(page.design_system_version ?? 1),
  });
  if (gates.kind === "failed") {
    await supabase.from("regeneration_events").insert({
      regeneration_job_id: jobId,
      type: "gates_failed",
      payload: {
        gate: gates.first_failure.gate,
        reason: gates.first_failure.reason,
        details: gates.first_failure.details ?? null,
        gates_run: gates.gates_run,
      },
    });
    await supabase
      .from("regeneration_jobs")
      .update({
        status: "failed_gates",
        failure_code: `GATE_${gates.first_failure.gate.toUpperCase()}`,
        failure_detail: gates.first_failure.reason,
        quality_gate_failures: {
          first_failure: gates.first_failure,
          gates_run: gates.gates_run,
        },
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        worker_id: null,
        lease_expires_at: null,
      })
      .eq("id", jobId);
    return {
      ok: false,
      code: "GATES_FAILED",
      message: `Quality gate '${gates.first_failure.gate}' rejected the regenerated HTML: ${gates.first_failure.reason}`,
      retryable: false,
      gate_failures: gates,
    };
  }

  // 2. Check for cached WP PUT success (partial-commit recovery).
  const wpPutEvent = priorEvents.find((e) => e.type === "wp_put_succeeded");
  let finalHtml = generatedHtml;
  let resultingSlug: string = page.slug as string;
  let driftDetected = false;
  let adoptedFromEvent = false;
  const wpPageId = Number(page.wp_page_id);

  if (wpPutEvent) {
    adoptedFromEvent = true;
    const payload = (wpPutEvent.payload ?? {}) as Record<string, unknown>;
    resultingSlug =
      (payload.resulting_slug as string) ?? (page.slug as string);
    driftDetected = Boolean(payload.drift_detected);
    // finalHtml stays as generatedHtml — we don't persist the full HTML
    // in the event payload (would blow the jsonb size budget); the
    // retry's fresh Anthropic response is guaranteed identical by the
    // idempotency_key cache. If that guarantee is broken (cache window
    // expired), the next worker tick re-fetches and proceeds afresh.
  } else {
    // 3. GET WP page, detect drift.
    const wpGet = await wp.getByWpPageId(wpPageId);
    if (!wpGet.ok) {
      return {
        ok: false,
        code: "WP_GET_FAILED",
        message: wpGet.message,
        retryable: wpGet.retryable,
      };
    }
    const wpSlug = wpGet.found?.slug ?? null;
    driftDetected = wpSlug !== null && wpSlug !== (page.slug as string);

    // 4. Image transfer.
    if (wp.media) {
      const cloudflareIds = extractCloudflareIds(generatedHtml);
      if (cloudflareIds.size > 0) {
        const transfer = await transferImagesForPage({
          cloudflareIds,
          siteId: site.id as string,
          wpMedia: wp.media,
          cloudflareUrlFor:
            wp.cloudflareUrlFor ??
            ((id) =>
              `https://imagedelivery.net/${process.env.CLOUDFLARE_IMAGES_HASH ?? ""}/${id}/public`),
        });
        if (!transfer.ok) {
          return {
            ok: false,
            code: "IMAGE_TRANSFER_FAILED",
            message: transfer.message,
            retryable: transfer.retryable,
          };
        }
        const rewrite = rewriteImageUrls(generatedHtml, transfer.mapping);
        finalHtml = rewrite.rewrittenHtml;
      }
    }

    // Prepend the LeadSource font-load <link> markup for the WP-bound
    // HTML only. `finalHtml` stays as the post-image-rewrite body so
    // the downstream `pages.generated_html` persist captures the model
    // output verbatim; fonts are a rendering concern injected at the
    // WP boundary. See lib/leadsource-fonts.ts.
    const wpBoundHtml = LEADSOURCE_FONT_LOAD_HTML + finalHtml;

    // 5. WP PUT.
    const wpPut = await wp.updateByWpPageId({
      wp_page_id: wpPageId,
      content: wpBoundHtml,
      slug: driftDetected ? (page.slug as string) : undefined,
      title: page.title as string,
      idempotency_key: job.wp_idempotency_key as string,
    });
    if (!wpPut.ok) {
      return {
        ok: false,
        code: "WP_PUT_FAILED",
        message: wpPut.message,
        retryable: wpPut.retryable,
      };
    }
    resultingSlug = wpPut.resulting_slug;

    // 6. Event-log-first: write wp_put_succeeded BEFORE pages UPDATE.
    const eventWrite = await supabase
      .from("regeneration_events")
      .insert({
        regeneration_job_id: jobId,
        type: "wp_put_succeeded",
        payload: {
          wp_page_id: wpPut.wp_page_id,
          resulting_slug: resultingSlug,
          drift_detected: driftDetected,
          final_html_bytes: finalHtml.length,
        },
      });
    if (eventWrite.error) {
      return {
        ok: false,
        code: "INTERNAL_ERROR",
        message: `wp_put_succeeded event write failed: ${eventWrite.error.message}`,
        retryable: true,
      };
    }
  }

  // 7. Commit to pages with optimistic lock.
  const pagesUpdate = await supabase
    .from("pages")
    .update({
      generated_html: finalHtml,
      version_lock: (job.expected_page_version as number) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", page.id as string)
    .eq("version_lock", job.expected_page_version as number)
    .select("id, version_lock")
    .maybeSingle();

  if (pagesUpdate.error) {
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: `pages UPDATE failed: ${pagesUpdate.error.message}`,
      retryable: true,
    };
  }
  if (!pagesUpdate.data) {
    // version_lock moved — a concurrent M6-3 edit landed. Terminal-fail
    // the regen (operator retries against the new version). The
    // wp_put_succeeded event stays on the job's history for forensics.
    await supabase
      .from("regeneration_jobs")
      .update({
        status: "failed",
        failure_code: "VERSION_CONFLICT",
        failure_detail: `pages.version_lock no longer equals ${job.expected_page_version}; a concurrent metadata edit landed.`,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        worker_id: null,
        lease_expires_at: null,
      })
      .eq("id", jobId);
    return {
      ok: false,
      code: "VERSION_CONFLICT",
      message:
        "Page metadata was edited after this regen started. The regen did not commit the new HTML.",
      retryable: false,
    };
  }

  // 8. Event log + terminal succeeded.
  await supabase.from("regeneration_events").insert({
    regeneration_job_id: jobId,
    type: "pages_committed",
    payload: {
      new_version_lock: pagesUpdate.data.version_lock,
      resulting_slug: resultingSlug,
      drift_detected: driftDetected,
    },
  });

  await finaliseRegenJob(supabase, jobId);

  return {
    ok: true,
    wp_page_id: wpPageId,
    resulting_slug: resultingSlug,
    drift_detected: driftDetected,
    adopted_from_event: adoptedFromEvent,
    final_html: finalHtml,
  };
}

async function finaliseRegenJob(
  supabase: ReturnType<typeof getServiceRoleClient>,
  jobId: string,
): Promise<void> {
  await supabase
    .from("regeneration_jobs")
    .update({
      status: "succeeded",
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      worker_id: null,
      lease_expires_at: null,
    })
    .eq("id", jobId);
}

// ---------------------------------------------------------------------------
// History reader (M7-4)
// ---------------------------------------------------------------------------

export type RegenJobRow = {
  id: string;
  status:
    | "pending"
    | "running"
    | "succeeded"
    | "failed"
    | "failed_gates"
    | "cancelled";
  cost_usd_cents: number;
  input_tokens: number;
  output_tokens: number;
  failure_code: string | null;
  failure_detail: string | null;
  quality_gate_failures: unknown;
  attempts: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  cancel_requested_at: string | null;
};

/**
 * List recent regen jobs for a page, newest first. Caller (the detail
 * page Server Component) decides the cap; default 10. The set is
 * always bounded — one page accumulates roughly one regen per
 * operator-triggered refresh.
 */
export async function listRegenJobsForPage(
  pageId: string,
  opts: { limit?: number } = {},
): Promise<RegenJobRow[]> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("regeneration_jobs")
    .select(
      "id, status, cost_usd_cents, input_tokens, output_tokens, failure_code, failure_detail, quality_gate_failures, attempts, created_at, started_at, finished_at, cancel_requested_at",
    )
    .eq("page_id", pageId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 10);
  if (error) {
    throw new Error(`listRegenJobsForPage failed: ${error.message}`);
  }
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    status: row.status as RegenJobRow["status"],
    cost_usd_cents: Number(row.cost_usd_cents ?? 0),
    input_tokens: Number(row.input_tokens ?? 0),
    output_tokens: Number(row.output_tokens ?? 0),
    failure_code: (row.failure_code as string | null) ?? null,
    failure_detail: (row.failure_detail as string | null) ?? null,
    quality_gate_failures: row.quality_gate_failures ?? null,
    attempts: Number(row.attempts ?? 0),
    created_at: row.created_at as string,
    started_at: (row.started_at as string | null) ?? null,
    finished_at: (row.finished_at as string | null) ?? null,
    cancel_requested_at: (row.cancel_requested_at as string | null) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Enqueue helper (M7-4)
// ---------------------------------------------------------------------------

export type EnqueueRegenJobInput = {
  site_id: string;
  page_id: string;
  created_by?: string | null;
};

export type EnqueueRegenJobResult =
  | { ok: true; job_id: string }
  | {
      ok: false;
      code:
        | "NOT_FOUND"
        | "REGEN_ALREADY_IN_FLIGHT"
        | "BUDGET_EXCEEDED"
        | "INTERNAL_ERROR";
      message: string;
      details?: Record<string, unknown>;
    };

/**
 * Daily budget cap (cents) for the sum of all regen jobs created
 * today. Reads from REGEN_DAILY_BUDGET_CENTS at call time. Defaults
 * to 10000 cents ($100/day) when unset — keep the knob in env so a
 * runaway regen loop on a new feature can't drain an operator's
 * Anthropic budget before they notice.
 *
 * Tenant-aware caps live in BACKLOG ("Per-tenant cost budgets");
 * this is the tenant-wide guard.
 */
export function readRegenDailyBudgetCents(): number {
  const raw = process.env.REGEN_DAILY_BUDGET_CENTS;
  if (!raw) return 10000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 10000;
  return Math.floor(parsed);
}

/**
 * Insert a new regeneration_jobs row for a page. Snapshots the page's
 * current version_lock into expected_page_version so the worker's
 * final commit can detect concurrent M6-3 edits. The partial UNIQUE on
 * (page_id) WHERE status IN ('pending','running') catches the double-
 * enqueue race: second attempt hits 23505 → REGEN_ALREADY_IN_FLIGHT.
 *
 * Caller (the POST route) is responsible for the admin gate and UUID
 * validation. This helper assumes well-formed ids.
 */
function requireDbUrl(): string {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      "SUPABASE_DB_URL is not set. Required by enqueueRegenJob for the budget reservation transaction.",
    );
  }
  return url;
}

export async function enqueueRegenJob(
  input: EnqueueRegenJobInput,
): Promise<EnqueueRegenJobResult> {
  const supabase = getServiceRoleClient();

  // Guard: page must belong to the site. Surfaces NOT_FOUND rather
  // than relying on the FK to fail later with a less friendly error.
  const pageRes = await supabase
    .from("pages")
    .select("id, site_id, version_lock")
    .eq("id", input.page_id)
    .eq("site_id", input.site_id)
    .maybeSingle();
  if (pageRes.error) {
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: `page lookup failed: ${pageRes.error.message}`,
    };
  }
  if (!pageRes.data) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: `No page found with id ${input.page_id} under site ${input.site_id}.`,
    };
  }

  // Tenant-wide ceiling (M7-5). Kept as the outer guard above the
  // per-tenant cap — prevents a new feature from draining every
  // operator's budget when one tenant happens to have a high cap.
  const cap = readRegenDailyBudgetCents();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const budgetRes = await supabase
    .from("regeneration_jobs")
    .select("cost_usd_cents")
    .gte("created_at", startOfDay.toISOString());
  if (budgetRes.error) {
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: `budget lookup failed: ${budgetRes.error.message}`,
    };
  }
  const todaySoFar = (budgetRes.data ?? []).reduce(
    (sum, row) => sum + Number(row.cost_usd_cents ?? 0),
    0,
  );
  if (todaySoFar >= cap) {
    return {
      ok: false,
      code: "BUDGET_EXCEEDED",
      message: `Daily regen budget of ${cap} cents is exhausted (${todaySoFar} spent today). Retry tomorrow or raise REGEN_DAILY_BUDGET_CENTS.`,
      details: {
        cap_cents: cap,
        spent_today_cents: todaySoFar,
        period: "tenant_wide",
      },
    };
  }

  // M8-2 — per-tenant cap + atomic insert inside one transaction.
  // reserveBudget holds SELECT FOR UPDATE on tenant_cost_budgets;
  // concurrent enqueues against the same tenant serialise. Rollback
  // on any failure releases the lock without charging the budget.
  const jobId = crypto.randomUUID();
  const client = new Client({ connectionString: requireDbUrl() });
  await client.connect();
  try {
    await client.query("BEGIN");

    const reservation = await reserveBudget(
      client,
      input.site_id,
      PROJECTED_COST_PER_REGEN_CENTS,
    );
    if (!reservation.ok) {
      await client.query("ROLLBACK");
      if (reservation.code === "BUDGET_EXCEEDED") {
        return {
          ok: false,
          code: "BUDGET_EXCEEDED",
          message: reservation.message,
          details: {
            cap_cents: reservation.cap_cents,
            usage_cents: reservation.usage_cents,
            projected_cents: reservation.projected_cents,
            period: reservation.period,
          },
        };
      }
      return {
        ok: false,
        code: "INTERNAL_ERROR",
        message: reservation.message,
      };
    }

    const insertRes = await client.query<{ id: string }>(
      `
      INSERT INTO regeneration_jobs
        (id, site_id, page_id, status, expected_page_version,
         anthropic_idempotency_key, wp_idempotency_key, created_by)
      VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7)
      RETURNING id
      `,
      [
        jobId,
        input.site_id,
        input.page_id,
        pageRes.data.version_lock as number,
        `ant-regen-${jobId}`,
        `wp-regen-${jobId}`,
        input.created_by ?? null,
      ],
    );

    await client.query("COMMIT");
    return { ok: true, job_id: insertRes.rows[0]!.id };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // swallow
    }
    const pgErr = err as { code?: string; message?: string };
    if (pgErr.code === "23505") {
      return {
        ok: false,
        code: "REGEN_ALREADY_IN_FLIGHT",
        message:
          "A regen is already pending or running for this page. Wait for it to finish before enqueuing another.",
        details: { page_id: input.page_id },
      };
    }
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: `regeneration_jobs insert failed: ${pgErr.message ?? String(err)}`,
    };
  } finally {
    await client.end();
  }
}
