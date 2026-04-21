import { Client, type QueryResult } from "pg";

import {
  defaultAnthropicCall,
  type AnthropicCallFn,
} from "@/lib/anthropic-call";
import { computeCostCents, PRICING_VERSION } from "@/lib/anthropic-pricing";
import {
  publishSlot,
  type WpCallBundle,
} from "@/lib/batch-publisher";
import { runGates } from "@/lib/quality-gates";
import { buildSystemPromptForSite } from "@/lib/system-prompt";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// M3-3 — Worker core.
//
// This is the most write-safety-critical slice of M3. The primitives
// here are the concurrency contract the rest of the milestone depends
// on; a bug here means two workers process the same slot, which means
// Anthropic gets billed twice (M3-4) and a duplicate page lands on the
// client's WordPress site (M3-6).
//
// Four primitives:
//
//   leaseNextPage(workerId, leaseDurationMs)
//     One transaction:
//       BEGIN;
//       SELECT … FROM generation_job_pages
//         WHERE <leasable predicate>
//         ORDER BY created_at
//         LIMIT 1
//         FOR UPDATE SKIP LOCKED;
//       UPDATE … SET state='leased', worker_id, lease_expires_at,
//                    attempts = attempts + 1, …;
//       COMMIT;
//     SKIP LOCKED is the only primitive that lets two workers share a
//     table safely: row A locked by worker 1 is invisible to worker 2's
//     SELECT-for-update, so worker 2 moves on to row B. attempts is
//     bumped on lease acquisition (not on completion) so a crashed
//     worker still has its budget counted — the retry cap in M3-7
//     relies on this.
//
//   heartbeat(slotId, workerId, leaseDurationMs)
//     Extends lease_expires_at iff worker_id still matches. If the
//     reaper has reclaimed the lease and another worker holds it, the
//     update affects zero rows and the caller knows to abandon.
//
//   reapExpiredLeases(now)
//     Resets any non-terminal slot with expired lease back to 'pending'
//     so the next worker can grab it. Also uses FOR UPDATE SKIP LOCKED
//     so two reapers racing don't double-reset.
//
//   processSlotDummy(slotId)
//     M3-3 placeholder. Walks the state machine (leased → generating →
//     validating → publishing → succeeded) writing placeholder content,
//     no Anthropic/WP calls. M3-4 replaces this with real Anthropic;
//     M3-5 inserts quality gates; M3-6 swaps publish for real WP.
//
// Runtime: nodejs. All functions accept an optional pg.Client so
// concurrency tests can supply isolated clients; in production the
// cron entrypoint opens one client per tick.
// ---------------------------------------------------------------------------

export const DEFAULT_LEASE_MS = 180_000; // 180s per M3 plan §2.
export const DEFAULT_HEARTBEAT_MS = 30_000;

// M3-7 retry budget. attempts is bumped on every lease; a slot that
// fails on its 3rd attempt has no remaining budget and goes terminal.
export const RETRY_MAX_ATTEMPTS = 3;

// Indexed by the `attempts` value AT THE TIME OF FAILURE (i.e. 1 = first
// attempt just failed, next retry waits 1s; 2 = second attempt just
// failed, next retry waits 5s). A 3rd failure exits the table and goes
// terminal per the cap above.
export const RETRY_BACKOFF_MS: Record<number, number> = {
  1: 1_000,
  2: 5_000,
};

export type LeasedSlot = {
  id: string;
  job_id: string;
  slot_index: number;
  attempts: number;
  inputs: Record<string, unknown>;
  anthropic_idempotency_key: string;
  wp_idempotency_key: string;
};

export type ReaperResult = { reapedCount: number };

function requireDbUrl(): string {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      "SUPABASE_DB_URL is not set. Required by batch worker for direct transactions.",
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
 * Lease the oldest pending (or expired-leased) slot for this worker.
 * Returns null when nothing is leasable. Exactly one worker will ever
 * see a given slot here — guaranteed by the combination of SKIP LOCKED
 * and the per-transaction commit.
 */
export async function leaseNextPage(
  workerId: string,
  opts: { leaseDurationMs?: number; client?: Client | null } = {},
): Promise<LeasedSlot | null> {
  const lease = opts.leaseDurationMs ?? DEFAULT_LEASE_MS;
  return withClient(opts.client ?? null, async (c) => {
    try {
      await c.query("BEGIN");

      // M3-7: pending slots with a retry_after in the future are
      // deferred (waiting out their exponential-backoff window) and
      // must be excluded. Expired leases on any non-terminal state
      // are always eligible — the reaper path handles stuck workers
      // regardless of retry_after.
      const candidate = await c.query<{ id: string }>(
        `
        SELECT id
          FROM generation_job_pages
         WHERE (
                 (
                   state = 'pending'
                   AND (retry_after IS NULL OR retry_after < now())
                 )
                 OR (
                   state IN ('leased', 'generating', 'validating', 'publishing')
                   AND lease_expires_at IS NOT NULL
                   AND lease_expires_at < now()
                 )
               )
         ORDER BY created_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED
        `,
      );
      if (candidate.rows.length === 0) {
        await c.query("COMMIT");
        return null;
      }
      const slotId = candidate.rows[0]!.id;

      const leased = await c.query<{
        id: string;
        job_id: string;
        slot_index: number;
        attempts: number;
        inputs: Record<string, unknown>;
        anthropic_idempotency_key: string;
        wp_idempotency_key: string;
      }>(
        `
        UPDATE generation_job_pages
           SET state = 'leased',
               worker_id = $2,
               lease_expires_at = now() + ($3 || ' milliseconds')::interval,
               last_heartbeat_at = now(),
               attempts = attempts + 1,
               started_at = COALESCE(started_at, now()),
               updated_at = now()
         WHERE id = $1
         RETURNING id, job_id, slot_index, attempts, inputs,
                   anthropic_idempotency_key, wp_idempotency_key
        `,
        [slotId, workerId, String(lease)],
      );

      await c.query("COMMIT");
      const row = leased.rows[0]!;
      return {
        id: row.id,
        job_id: row.job_id,
        slot_index: row.slot_index,
        attempts: row.attempts,
        inputs: row.inputs,
        anthropic_idempotency_key: row.anthropic_idempotency_key,
        wp_idempotency_key: row.wp_idempotency_key,
      };
    } catch (err) {
      try {
        await c.query("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    }
  });
}

/**
 * Extend the lease on `slotId` iff this worker still owns it. Returns
 * true on success, false if the lease was stolen (worker_id changed)
 * or the slot is in a terminal state.
 */
export async function heartbeat(
  slotId: string,
  workerId: string,
  opts: { leaseDurationMs?: number; client?: Client | null } = {},
): Promise<boolean> {
  const lease = opts.leaseDurationMs ?? DEFAULT_LEASE_MS;
  return withClient(opts.client ?? null, async (c) => {
    const res = await c.query(
      `
      UPDATE generation_job_pages
         SET lease_expires_at = now() + ($3 || ' milliseconds')::interval,
             last_heartbeat_at = now(),
             updated_at = now()
       WHERE id = $1
         AND worker_id = $2
         AND state IN ('leased', 'generating', 'validating', 'publishing')
      `,
      [slotId, workerId, String(lease)],
    );
    return (res.rowCount ?? 0) > 0;
  });
}

/**
 * Reset any non-terminal slot whose lease has expired back to
 * 'pending' so the next lease attempt can pick it up. Uses FOR UPDATE
 * SKIP LOCKED so two reapers racing don't double-reset.
 */
export async function reapExpiredLeases(
  opts: { client?: Client | null } = {},
): Promise<ReaperResult> {
  return withClient(opts.client ?? null, async (c) => {
    try {
      await c.query("BEGIN");

      const expired = await c.query<{ id: string }>(
        `
        SELECT id
          FROM generation_job_pages
         WHERE state IN ('leased', 'generating', 'validating', 'publishing')
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
      const reset: QueryResult = await c.query(
        `
        UPDATE generation_job_pages
           SET state = 'pending',
               worker_id = NULL,
               lease_expires_at = NULL,
               updated_at = now()
         WHERE id = ANY($1::uuid[])
        `,
        [ids],
      );

      // Append one event per reaped slot so the audit log records
      // that someone (not a worker) advanced the state machine.
      await c.query(
        `
        INSERT INTO generation_events (job_id, page_slot_id, event, details)
        SELECT job_id, id, 'lease_reaped',
               jsonb_build_object('previous_worker_id', worker_id,
                                  'previous_state', state)
          FROM generation_job_pages
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
        // ignore
      }
      throw err;
    }
  });
}

/**
 * M3-3 placeholder that walks a slot through the state machine to
 * `succeeded` without calling Anthropic or WordPress. M3-4+ replace
 * this with the real pipeline. Each state transition is a separate
 * UPDATE so the reaper can rescue a worker that crashes mid-walk.
 */
export async function processSlotDummy(
  slotId: string,
  workerId: string,
  opts: { client?: Client | null } = {},
): Promise<void> {
  await withClient(opts.client ?? null, async (c) => {
    for (const next of [
      "generating",
      "validating",
      "publishing",
    ] as const) {
      const res = await c.query(
        `
        UPDATE generation_job_pages
           SET state = $2,
               last_heartbeat_at = now(),
               updated_at = now()
         WHERE id = $1 AND worker_id = $3
        `,
        [slotId, next, workerId],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new Error(
          `processSlotDummy: lease stolen from worker ${workerId} at state ${next}`,
        );
      }
      await c.query(
        `
        INSERT INTO generation_events (job_id, page_slot_id, event, details)
        SELECT job_id, id, 'state_advanced',
               jsonb_build_object('to', $2::text, 'worker_id', $3::text)
          FROM generation_job_pages
         WHERE id = $1
        `,
        [slotId, next, workerId],
      );
    }

    const succeeded = await c.query(
      `
      UPDATE generation_job_pages
         SET state = 'succeeded',
             finished_at = now(),
             lease_expires_at = NULL,
             worker_id = NULL,
             updated_at = now()
       WHERE id = $1 AND worker_id = $2
      `,
      [slotId, workerId],
    );
    if ((succeeded.rowCount ?? 0) === 0) {
      throw new Error(
        `processSlotDummy: lease stolen from worker ${workerId} at final transition`,
      );
    }

    // Roll succeeded_count on the parent job atomically. This is the
    // only place we touch generation_jobs.succeeded_count; adding up
    // these per-slot increments is equivalent to a job-level SUM()
    // but cheaper on the job list page.
    await c.query(
      `
      UPDATE generation_jobs j
         SET succeeded_count = succeeded_count + 1,
             status = CASE
                        WHEN j.succeeded_count + 1 + j.failed_count
                             >= j.requested_count
                          THEN 'succeeded'
                        ELSE 'running'
                      END,
             finished_at = CASE
                             WHEN j.succeeded_count + 1 + j.failed_count
                                  >= j.requested_count
                               THEN now()
                             ELSE j.finished_at
                           END,
             updated_at = now()
        FROM generation_job_pages p
       WHERE p.id = $1 AND p.job_id = j.id
      `,
      [slotId],
    );
  });
}

// ---------------------------------------------------------------------------
// processSlotAnthropic — M3-4 real-call path
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = "claude-opus-4-7";
const DEFAULT_MAX_TOKENS = 8192;

async function loadSlotContext(slotId: string): Promise<{
  job_id: string;
  site: { site_name: string; prefix: string; id: string };
  design_system_version: string;
  inputs: Record<string, unknown>;
  anthropic_idempotency_key: string;
}> {
  const svc = getServiceRoleClient();
  // Two-step: the PostgREST embed path confuses TS inference beyond
  // the point of being worth it; a service-role JOIN gets the same
  // rows with a type we can hand-annotate.
  const slotRes = await svc
    .from("generation_job_pages")
    .select("job_id, inputs, anthropic_idempotency_key")
    .eq("id", slotId)
    .single();
  if (slotRes.error || !slotRes.data) {
    throw new Error(
      `loadSlotContext slot: ${slotRes.error?.message ?? "no row"} for slot ${slotId}`,
    );
  }

  const jobRes = await svc
    .from("generation_jobs")
    .select("site_id")
    .eq("id", slotRes.data.job_id as string)
    .single();
  if (jobRes.error || !jobRes.data) {
    throw new Error(
      `loadSlotContext job: ${jobRes.error?.message ?? "no row"} for job ${slotRes.data.job_id}`,
    );
  }

  const siteRes = await svc
    .from("sites")
    .select("id, name, prefix")
    .eq("id", jobRes.data.site_id as string)
    .single();
  if (siteRes.error || !siteRes.data) {
    throw new Error(
      `loadSlotContext site: ${siteRes.error?.message ?? "no row"}`,
    );
  }

  const dsRes = await svc
    .from("design_systems")
    .select("version")
    .eq("site_id", siteRes.data.id as string)
    .eq("status", "active")
    .maybeSingle();
  const dsVersion = (dsRes.data?.version as number | undefined) ?? 1;

  return {
    job_id: slotRes.data.job_id as string,
    site: {
      id: siteRes.data.id as string,
      site_name: siteRes.data.name as string,
      prefix: siteRes.data.prefix as string,
    },
    design_system_version: String(dsVersion),
    inputs:
      (slotRes.data.inputs as Record<string, unknown> | null) ?? {},
    anthropic_idempotency_key:
      slotRes.data.anthropic_idempotency_key as string,
  };
}

function buildUserMessage(inputs: Record<string, unknown>): string {
  return [
    "Generate a page against the design system described in the system prompt.",
    "Return only the HTML for the page body (no <html>, <head>, or surrounding markup).",
    "Brief:",
    "```json",
    JSON.stringify(inputs, null, 2),
    "```",
  ].join("\n");
}

/**
 * Production slot processor. Replaces processSlotDummy once ANTHROPIC_API_KEY
 * is wired. Walks leased → generating → (Anthropic call) → succeeded,
 * writing the anthropic_response_received event BEFORE the slot's cost
 * columns update so billing facts are reconstructible from the event log
 * even if the subsequent UPDATE fails.
 *
 * M3-5 will insert the validating state between generating and succeeded;
 * M3-6 will insert publishing and defer succeeded until WP confirms.
 */
export async function processSlotAnthropic(
  slotId: string,
  workerId: string,
  opts: {
    client?: Client | null;
    anthropicCall?: AnthropicCallFn;
    model?: string;
    maxTokens?: number;
    wp?: WpCallBundle;
  } = {},
): Promise<void> {
  const call = opts.anthropicCall ?? defaultAnthropicCall;
  const model = opts.model ?? DEFAULT_MODEL;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;

  const ctx = await loadSlotContext(slotId);
  const systemPrompt = await buildSystemPromptForSite({
    id: ctx.site.id,
    site_name: ctx.site.site_name,
    prefix: ctx.site.prefix,
    design_system_version: ctx.design_system_version,
  });
  const userMessage = buildUserMessage(ctx.inputs);

  await withClient(opts.client ?? null, async (c) => {
    // leased → generating: stamps the state change on the slot + event log
    // so the audit log shows exactly when we started talking to Anthropic.
    const advance = await c.query(
      `
      UPDATE generation_job_pages
         SET state = 'generating',
             last_heartbeat_at = now(),
             updated_at = now()
       WHERE id = $1 AND worker_id = $2 AND state = 'leased'
      `,
      [slotId, workerId],
    );
    if ((advance.rowCount ?? 0) === 0) {
      throw new Error(
        `processSlotAnthropic: lease stolen from worker ${workerId} before Anthropic call`,
      );
    }
    await c.query(
      `
      INSERT INTO generation_events (job_id, page_slot_id, event, details)
      VALUES ($1, $2, 'state_advanced',
              jsonb_build_object('to', 'generating', 'worker_id', $3::text))
      `,
      [ctx.job_id, slotId, workerId],
    );
  });

  // Anthropic call. Released from the pg client so Postgres doesn't hold
  // a connection open for the duration of the API round-trip. If this
  // throws, the slot stays in 'generating' and the reaper picks it up;
  // the retry will reuse the same idempotency key so Anthropic returns
  // the cached response without re-billing.
  const response = await call({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    idempotency_key: ctx.anthropic_idempotency_key,
  });

  const { cents, rateFound } = computeCostCents(response.model, response.usage);
  const generatedHtml = response.content
    .map((b) => b.text)
    .join("")
    .trim();

  // M3-5: gate check runs between Anthropic response and the final
  // slot UPDATE. Compute it OUTSIDE the DB transaction — gates are
  // pure functions over the HTML + slot inputs.
  const slug =
    typeof (ctx.inputs as { slug?: unknown }).slug === "string"
      ? ((ctx.inputs as { slug: string }).slug as string)
      : null;
  const gateOutcome = runGates({
    html: generatedHtml,
    slug,
    prefix: ctx.site.prefix,
    design_system_version: ctx.design_system_version,
  });

  await withClient(opts.client ?? null, async (c) => {
    // EVENT LOG FIRST. If the subsequent slot UPDATE fails (DB blip,
    // network hiccup), the billing facts still persist and a
    // reconciliation job can rebuild cost totals from the event log.
    // This is the §10 row-3 mitigation from the M3 plan.
    await c.query(
      `
      INSERT INTO generation_events (job_id, page_slot_id, event, details)
      VALUES ($1, $2, 'anthropic_response_received',
              jsonb_build_object(
                'anthropic_response_id', $3::text,
                'model', $4::text,
                'input_tokens', $5::int,
                'output_tokens', $6::int,
                'cache_creation_input_tokens', $7::int,
                'cache_read_input_tokens', $8::int,
                'cost_usd_cents', $9::bigint,
                'pricing_version', $10::text,
                'rate_found', $11::boolean,
                'worker_id', $12::text
              ))
      `,
      [
        ctx.job_id,
        slotId,
        response.id,
        response.model,
        response.usage.input_tokens,
        response.usage.output_tokens,
        response.usage.cache_creation_input_tokens ?? 0,
        response.usage.cache_read_input_tokens ?? 0,
        cents,
        PRICING_VERSION,
        rateFound,
        workerId,
      ],
    );

    // generating → validating: records the state transition even on
    // gate failure so the audit log shows the slot entered the gate
    // step. Guarded by worker_id.
    const advanceValidating = await c.query(
      `
      UPDATE generation_job_pages
         SET state = 'validating',
             last_heartbeat_at = now(),
             updated_at = now()
       WHERE id = $1 AND worker_id = $2 AND state = 'generating'
      `,
      [slotId, workerId],
    );
    if ((advanceValidating.rowCount ?? 0) === 0) {
      throw new Error(
        `processSlotAnthropic: lease stolen or state changed before validating slot ${slotId}`,
      );
    }
    await c.query(
      `
      INSERT INTO generation_events (job_id, page_slot_id, event, details)
      VALUES ($1, $2, 'state_advanced',
              jsonb_build_object('to', 'validating', 'worker_id', $3::text,
                                 'gates_run', $4::jsonb))
      `,
      [
        ctx.job_id,
        slotId,
        workerId,
        JSON.stringify(gateOutcome.gates_run),
      ],
    );

    if (gateOutcome.kind === "failed") {
      const fail = gateOutcome.first_failure;
      await c.query(
        `
        INSERT INTO generation_events (job_id, page_slot_id, event, details)
        VALUES ($1, $2, 'gate_failed',
                jsonb_build_object(
                  'gate', $3::text,
                  'reason', $4::text,
                  'details', $5::jsonb,
                  'gates_run', $6::jsonb,
                  'worker_id', $7::text
                ))
        `,
        [
          ctx.job_id,
          slotId,
          fail.gate,
          fail.reason,
          JSON.stringify(fail.details ?? {}),
          JSON.stringify(gateOutcome.gates_run),
          workerId,
        ],
      );

      const markFailed = await c.query(
        `
        UPDATE generation_job_pages
           SET state = 'failed',
               generated_html = $4,
               anthropic_raw_response_id = $3,
               cost_usd_cents = $5,
               input_tokens = $6,
               output_tokens = $7,
               cached_tokens = $8,
               last_error_code = 'QUALITY_GATE_FAILED',
               last_error_message = $9,
               quality_gate_failures = $10::jsonb,
               finished_at = now(),
               lease_expires_at = NULL,
               worker_id = NULL,
               updated_at = now()
         WHERE id = $1 AND worker_id = $2 AND state = 'validating'
        `,
        [
          slotId,
          workerId,
          response.id,
          generatedHtml,
          cents,
          response.usage.input_tokens,
          response.usage.output_tokens,
          (response.usage.cache_creation_input_tokens ?? 0) +
            (response.usage.cache_read_input_tokens ?? 0),
          `${fail.gate}: ${fail.reason}`,
          JSON.stringify([fail]),
        ],
      );
      if ((markFailed.rowCount ?? 0) === 0) {
        throw new Error(
          `processSlotAnthropic: lease stolen while marking slot ${slotId} failed`,
        );
      }

      // Roll failed_count + cost on the parent job. Cost tokens still
      // recorded because we paid Anthropic even when the gate says no.
      await c.query(
        `
        UPDATE generation_jobs j
           SET failed_count = failed_count + 1,
               total_cost_usd_cents = total_cost_usd_cents + $2,
               total_input_tokens   = total_input_tokens + $3,
               total_output_tokens  = total_output_tokens + $4,
               total_cached_tokens  = total_cached_tokens + $5,
               status = CASE
                          WHEN j.succeeded_count + j.failed_count + 1
                               >= j.requested_count
                            THEN CASE
                                   WHEN j.succeeded_count = 0
                                     THEN 'failed'
                                   ELSE 'partial'
                                 END
                          ELSE 'running'
                        END,
               finished_at = CASE
                               WHEN j.succeeded_count + j.failed_count + 1
                                    >= j.requested_count
                                 THEN now()
                               ELSE j.finished_at
                             END,
               updated_at = now()
         WHERE id = $1
        `,
        [
          ctx.job_id,
          cents,
          response.usage.input_tokens,
          response.usage.output_tokens,
          (response.usage.cache_creation_input_tokens ?? 0) +
            (response.usage.cache_read_input_tokens ?? 0),
        ],
      );

      await c.query(
        `
        INSERT INTO generation_events (job_id, page_slot_id, event, details)
        VALUES ($1, $2, 'state_advanced',
                jsonb_build_object('to', 'failed', 'worker_id', $3::text,
                                   'reason', 'quality_gate_failed'))
        `,
        [ctx.job_id, slotId, workerId],
      );
      return;
    }

    // Gates passed. Save cost/tokens/html on the slot FIRST (state
    // stays 'validating'), THEN branch:
    //   - opts.wp present → publishSlot advances validating →
    //     publishing → succeeded (or marks 'failed' on WP error).
    //   - opts.wp absent   → advance directly to 'succeeded' (the
    //     M3-4/M3-5 path; keeps dummy / test paths working without
    //     WP credentials).
    // Cost is recorded regardless of what happens after — we paid
    // Anthropic, that's the billing truth.
    const saveCost = await c.query(
      `
      UPDATE generation_job_pages
         SET generated_html = $4,
             anthropic_raw_response_id = $3,
             cost_usd_cents = $5,
             input_tokens = $6,
             output_tokens = $7,
             cached_tokens = $8,
             last_heartbeat_at = now(),
             updated_at = now()
       WHERE id = $1 AND worker_id = $2 AND state = 'validating'
      `,
      [
        slotId,
        workerId,
        response.id,
        generatedHtml,
        cents,
        response.usage.input_tokens,
        response.usage.output_tokens,
        (response.usage.cache_creation_input_tokens ?? 0) +
          (response.usage.cache_read_input_tokens ?? 0),
      ],
    );
    if ((saveCost.rowCount ?? 0) === 0) {
      throw new Error(
        `processSlotAnthropic: lease stolen or state changed before cost save for slot ${slotId}`,
      );
    }

    // Roll the parent job's cost aggregates immediately. succeeded_count
    // is advanced later by whichever branch closes the slot.
    await c.query(
      `
      UPDATE generation_jobs j
         SET total_cost_usd_cents = total_cost_usd_cents + $2,
             total_input_tokens   = total_input_tokens + $3,
             total_output_tokens  = total_output_tokens + $4,
             total_cached_tokens  = total_cached_tokens + $5,
             updated_at = now()
       WHERE id = $1
      `,
      [
        ctx.job_id,
        cents,
        response.usage.input_tokens,
        response.usage.output_tokens,
        (response.usage.cache_creation_input_tokens ?? 0) +
          (response.usage.cache_read_input_tokens ?? 0),
      ],
    );

    if (!opts.wp) {
      // No WP bundle → skip publish; close the slot.
      const finalise = await c.query(
        `
        UPDATE generation_job_pages
           SET state = 'succeeded',
               finished_at = now(),
               lease_expires_at = NULL,
               worker_id = NULL,
               updated_at = now()
         WHERE id = $1 AND worker_id = $2 AND state = 'validating'
        `,
        [slotId, workerId],
      );
      if ((finalise.rowCount ?? 0) === 0) {
        throw new Error(
          `processSlotAnthropic: lease stolen or state changed before finalising slot ${slotId}`,
        );
      }
      await c.query(
        `
        UPDATE generation_jobs j
           SET succeeded_count = succeeded_count + 1,
               status = CASE
                          WHEN j.succeeded_count + 1 + j.failed_count
                               >= j.requested_count
                            THEN CASE
                                   WHEN j.failed_count = 0 THEN 'succeeded'
                                   ELSE 'partial'
                                 END
                          ELSE 'running'
                        END,
               finished_at = CASE
                               WHEN j.succeeded_count + 1 + j.failed_count
                                    >= j.requested_count
                                 THEN now()
                               ELSE j.finished_at
                             END,
               updated_at = now()
         WHERE id = $1
        `,
        [ctx.job_id],
      );
      await c.query(
        `
        INSERT INTO generation_events (job_id, page_slot_id, event, details)
        VALUES ($1, $2, 'state_advanced',
                jsonb_build_object('to', 'succeeded', 'worker_id', $3::text))
        `,
        [ctx.job_id, slotId, workerId],
      );
    }
  });

  // -----------------------------------------------------------------------
  // WP publish (M3-6). Only runs when the caller supplied a WpCallBundle.
  // -----------------------------------------------------------------------
  if (opts.wp) {
    const slug =
      typeof (ctx.inputs as { slug?: unknown }).slug === "string"
        ? ((ctx.inputs as { slug: string }).slug as string)
        : `slot-${ctx.job_id.slice(0, 8)}-${Date.now()}`;
    const title =
      typeof (ctx.inputs as { title?: unknown }).title === "string"
        ? ((ctx.inputs as { title: string }).title as string)
        : slug;

    const result = await publishSlot(
      slotId,
      workerId,
      {
        job_id: ctx.job_id,
        site_id: ctx.site.id,
        slug,
        title,
        generated_html: generatedHtml,
        design_system_version: ctx.design_system_version,
      },
      opts.wp,
      { client: opts.client ?? null },
    );

    if (!result.ok) {
      // M3-7: decide retry-defer vs. terminal-fail. Retry-defer when
      // the error is retryable AND we still have budget
      // (attempts < RETRY_MAX_ATTEMPTS). Anything else is terminal.
      await withClient(opts.client ?? null, async (c) => {
        await c.query(
          `
          INSERT INTO generation_events (job_id, page_slot_id, event, details)
          VALUES ($1, $2, 'publish_failed',
                  jsonb_build_object('code', $3::text,
                                     'message', $4::text,
                                     'retryable', $5::boolean,
                                     'worker_id', $6::text))
          `,
          [
            ctx.job_id,
            slotId,
            result.code,
            result.message,
            result.retryable,
            workerId,
          ],
        );

        // Fetch current attempts to decide. We bumped it on lease so
        // this value is "attempts made including the one we just
        // completed (failed)".
        const attemptRow = await c.query<{ attempts: number }>(
          `SELECT attempts FROM generation_job_pages WHERE id = $1`,
          [slotId],
        );
        const attempts = attemptRow.rows[0]?.attempts ?? RETRY_MAX_ATTEMPTS;
        const shouldRetry =
          result.retryable && attempts < RETRY_MAX_ATTEMPTS;

        if (shouldRetry) {
          // Defer: slot → 'pending' with retry_after set to the
          // backoff for this attempt count. The lease-candidate query
          // excludes pending rows whose retry_after is in the future,
          // so the reaper and other workers skip this slot until its
          // backoff expires.
          const backoffMs = RETRY_BACKOFF_MS[attempts] ?? 30_000;

          const deferred = await c.query(
            `
            UPDATE generation_job_pages
               SET state = 'pending',
                   worker_id = NULL,
                   lease_expires_at = NULL,
                   retry_after = now() + ($3 || ' milliseconds')::interval,
                   last_error_code = $4,
                   last_error_message = $5,
                   updated_at = now()
             WHERE id = $1 AND worker_id = $2 AND state = 'publishing'
            `,
            [slotId, workerId, String(backoffMs), result.code, result.message],
          );
          if ((deferred.rowCount ?? 0) === 0) {
            throw new Error(
              `processSlotAnthropic: lease stolen while deferring slot ${slotId}`,
            );
          }
          await c.query(
            `
            INSERT INTO generation_events (job_id, page_slot_id, event, details)
            VALUES ($1, $2, 'retry_scheduled',
                    jsonb_build_object('attempts', $3::int,
                                       'backoff_ms', $4::int,
                                       'code', $5::text,
                                       'worker_id', $6::text))
            `,
            [
              ctx.job_id,
              slotId,
              attempts,
              backoffMs,
              result.code,
              workerId,
            ],
          );
          return;
        }

        // Terminal failure path: cap reached OR non-retryable.
        const markFailed = await c.query(
          `
          UPDATE generation_job_pages
             SET state = 'failed',
                 last_error_code = $3,
                 last_error_message = $4,
                 finished_at = now(),
                 lease_expires_at = NULL,
                 worker_id = NULL,
                 updated_at = now()
           WHERE id = $1 AND worker_id = $2 AND state = 'publishing'
          `,
          [slotId, workerId, result.code, result.message],
        );
        if ((markFailed.rowCount ?? 0) === 0) {
          throw new Error(
            `processSlotAnthropic: lease stolen while marking slot ${slotId} publish_failed`,
          );
        }
        await c.query(
          `
          UPDATE generation_jobs j
             SET failed_count = failed_count + 1,
                 status = CASE
                            WHEN j.succeeded_count + j.failed_count + 1
                                 >= j.requested_count
                              THEN CASE
                                     WHEN j.succeeded_count = 0
                                       THEN 'failed'
                                     ELSE 'partial'
                                   END
                            ELSE 'running'
                          END,
                 finished_at = CASE
                                 WHEN j.succeeded_count + j.failed_count + 1
                                      >= j.requested_count
                                   THEN now()
                                 ELSE j.finished_at
                               END,
                 updated_at = now()
           WHERE id = $1
          `,
          [ctx.job_id],
        );
        await c.query(
          `
          INSERT INTO generation_events (job_id, page_slot_id, event, details)
          VALUES ($1, $2, 'state_advanced',
                  jsonb_build_object('to', 'failed', 'worker_id', $3::text,
                                     'reason', 'publish_failed',
                                     'attempts', $4::int,
                                     'retryable', $5::boolean))
          `,
          [ctx.job_id, slotId, workerId, attempts, result.retryable],
        );
      });
    }
    // Success: publishSlot has already advanced slot → succeeded and
    // ticked the parent job's succeeded_count. Nothing further to do.
  }
}
