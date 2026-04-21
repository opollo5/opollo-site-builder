import { Client, type QueryResult } from "pg";

import {
  CaptionCallError,
  defaultAnthropicCaptionCall,
  parseCaptionPayload,
  type AnthropicCaptionCallFn,
  type CaptionPayload,
  CAPTION_MODEL,
  CAPTION_MAX_TOKENS,
} from "@/lib/anthropic-caption";
import { computeCostCents, PRICING_VERSION } from "@/lib/anthropic-pricing";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// M4-2 — Transfer worker core.
//
// The image-library analog of M3-3's batch worker. Same primitives:
//   leaseNextTransferItem — atomic SELECT ... FOR UPDATE SKIP LOCKED +
//                           UPDATE to 'leased' in one transaction.
//   heartbeat             — extend lease iff this worker still owns it.
//   reapExpiredLeases     — reset non-terminal rows past their lease
//                           window back to 'pending', bump retry_count.
//   processTransferItemDummy — M4-2 placeholder; walks a cloudflare_ingest
//                              item through 'uploading' → 'captioning' →
//                              'succeeded' without external calls. M4-3
//                              swaps 'uploading' for a real Cloudflare
//                              POST; M4-4 swaps 'captioning' for a real
//                              Anthropic vision call; M4-7 covers the
//                              wp_media_transfer path.
//
// Write-safety contract (per docs/patterns/background-worker-with-
// write-safety.md):
//   - Atomic lease: SKIP LOCKED + transaction. No two workers can lease
//     the same item.
//   - Lease coherence: UPDATEs during processing include worker_id =
//     $workerId AND state IN ('leased','uploading','captioning',
//     'publishing') AND lease_expires_at > now(). If a reaper relet the
//     item to another worker, the stale worker's UPDATE affects zero
//     rows — caller aborts without clobbering the new owner's state.
//   - retry_count bumped on lease acquisition (not on completion) so a
//     crashed worker still consumes its budget, per M3's retry-cap rule.
//   - Idempotency keys pre-computed at insert time (migration 0010);
//     reuse across retries prevents Cloudflare + Anthropic double-
//     billing.
//   - Event-log first: every stage write hits transfer_events before
//     the state column flips. Reconciliation reads events.
//
// Runtime: nodejs. Functions accept an optional pg.Client so the
// concurrency tests can supply isolated clients; production opens one
// client per cron tick.
// ---------------------------------------------------------------------------

export const DEFAULT_LEASE_MS = 180_000; // 180s — matches M3's worker cap.
export const DEFAULT_HEARTBEAT_MS = 30_000;

// Mirrors M3-7's retry budget. retry_count bumped on every lease; an
// item that fails its 3rd attempt exhausts its budget and goes
// terminal. M4-3 adds the terminal-transition logic.
export const RETRY_MAX_ATTEMPTS = 3;

// Indexed by the retry_count value AT THE TIME OF FAILURE (1 = first
// failure → next retry waits 1s; 2 = second failure → next waits 5s).
// A 3rd failure exits the table and goes terminal.
export const RETRY_BACKOFF_MS: Record<number, number> = {
  1: 1_000,
  2: 5_000,
};

// The shape `processTransferItem*` receives from `leaseNext*`.
export type LeasedTransferItem = {
  id: string;
  transfer_job_id: string;
  slot_index: number;
  retry_count: number;
  image_id: string | null;
  target_site_id: string | null;
  source_url: string | null;
  cloudflare_idempotency_key: string;
  anthropic_idempotency_key: string;
};

export type ReaperResult = { reapedCount: number };

function requireDbUrl(): string {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      "SUPABASE_DB_URL is not set. Required by transfer worker for direct transactions.",
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
 * Lease the oldest leasable `transfer_job_items` row for this worker.
 * "Leasable" means:
 *   - state='pending' with retry_after unset or elapsed, OR
 *   - state IN ('leased','uploading','captioning','publishing') with
 *     lease_expires_at in the past (reaper-adjacent rescue path —
 *     a stuck worker's lease is always eligible regardless of
 *     retry_after).
 *
 * Returns null when nothing is leasable.
 */
export async function leaseNextTransferItem(
  workerId: string,
  opts: { leaseDurationMs?: number; client?: Client | null } = {},
): Promise<LeasedTransferItem | null> {
  const lease = opts.leaseDurationMs ?? DEFAULT_LEASE_MS;
  return withClient(opts.client ?? null, async (c) => {
    try {
      await c.query("BEGIN");

      const candidate = await c.query<{ id: string }>(
        `
        SELECT id
          FROM transfer_job_items
         WHERE (
                 (
                   state = 'pending'
                   AND (retry_after IS NULL OR retry_after < now())
                 )
                 OR (
                   state IN ('leased', 'uploading', 'captioning', 'publishing')
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
      const itemId = candidate.rows[0]!.id;

      const leased = await c.query<{
        id: string;
        transfer_job_id: string;
        slot_index: number;
        retry_count: number;
        image_id: string | null;
        target_site_id: string | null;
        source_url: string | null;
        cloudflare_idempotency_key: string;
        anthropic_idempotency_key: string;
      }>(
        `
        UPDATE transfer_job_items
           SET state = 'leased',
               worker_id = $2,
               lease_expires_at = now() + ($3 || ' milliseconds')::interval,
               retry_count = retry_count + 1,
               updated_at = now()
         WHERE id = $1
         RETURNING id, transfer_job_id, slot_index, retry_count,
                   image_id, target_site_id, source_url,
                   cloudflare_idempotency_key, anthropic_idempotency_key
        `,
        [itemId, workerId, String(lease)],
      );

      await c.query("COMMIT");
      const row = leased.rows[0]!;
      return {
        id: row.id,
        transfer_job_id: row.transfer_job_id,
        slot_index: row.slot_index,
        retry_count: row.retry_count,
        image_id: row.image_id,
        target_site_id: row.target_site_id,
        source_url: row.source_url,
        cloudflare_idempotency_key: row.cloudflare_idempotency_key,
        anthropic_idempotency_key: row.anthropic_idempotency_key,
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
 * Extend the lease on `itemId` iff this worker still owns it. Returns
 * true on success, false if the lease was stolen (worker_id changed)
 * or the item is in a terminal state.
 */
export async function heartbeat(
  itemId: string,
  workerId: string,
  opts: { leaseDurationMs?: number; client?: Client | null } = {},
): Promise<boolean> {
  const lease = opts.leaseDurationMs ?? DEFAULT_LEASE_MS;
  return withClient(opts.client ?? null, async (c) => {
    const res = await c.query(
      `
      UPDATE transfer_job_items
         SET lease_expires_at = now() + ($3 || ' milliseconds')::interval,
             updated_at = now()
       WHERE id = $1
         AND worker_id = $2
         AND state IN ('leased', 'uploading', 'captioning', 'publishing')
      `,
      [itemId, workerId, String(lease)],
    );
    return (res.rowCount ?? 0) > 0;
  });
}

/**
 * Reset any non-terminal item whose lease has expired back to
 * 'pending' so the next lease attempt can pick it up. Uses FOR UPDATE
 * SKIP LOCKED so two reapers racing don't double-reset. Emits one
 * 'item_reaped' event per reset row so the audit log reflects the
 * state-machine advance the crashed worker never wrote.
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
          FROM transfer_job_items
         WHERE state IN ('leased', 'uploading', 'captioning', 'publishing')
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

      // Capture pre-reset state for the audit log before the UPDATE
      // clears worker_id / state back to pending.
      await c.query(
        `
        INSERT INTO transfer_events (
          transfer_job_id, transfer_job_item_id, event_type, payload_jsonb
        )
        SELECT transfer_job_id, id, 'item_reaped',
               jsonb_build_object('previous_worker_id', worker_id,
                                  'previous_state', state)
          FROM transfer_job_items
         WHERE id = ANY($1::uuid[])
        `,
        [ids],
      );

      const reset: QueryResult = await c.query(
        `
        UPDATE transfer_job_items
           SET state = 'pending',
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
        // ignore
      }
      throw err;
    }
  });
}

/**
 * M4-2 placeholder that walks a cloudflare_ingest item through the
 * state machine to `succeeded` without calling Cloudflare or
 * Anthropic. M4-3 replaces the 'uploading' transition with a real
 * Cloudflare POST; M4-4 replaces the 'captioning' transition with a
 * real Anthropic vision call.
 *
 * Each state transition is a separate UPDATE so the reaper can rescue
 * a worker that crashes mid-walk. The lease-coherence filter on every
 * UPDATE ensures a reaped + relet item rejects the stale worker's
 * late write.
 */
export async function processTransferItemDummy(
  itemId: string,
  workerId: string,
  opts: { client?: Client | null } = {},
): Promise<void> {
  await withClient(opts.client ?? null, async (c) => {
    for (const next of ["uploading", "captioning", "succeeded"] as const) {
      // Event log first: record the intent to transition before the
      // state column flips. Reconciliation reads events; if the state
      // UPDATE fails (stolen lease), the event is still there as a
      // marker that this worker attempted the transition.
      await c.query(
        `
        INSERT INTO transfer_events (
          transfer_job_id, transfer_job_item_id, event_type, payload_jsonb
        )
        SELECT transfer_job_id, id, 'state_advanced',
               jsonb_build_object('to', $2::text, 'worker_id', $3::text,
                                  'processor', 'dummy')
          FROM transfer_job_items
         WHERE id = $1
        `,
        [itemId, next, workerId],
      );

      const res = await c.query(
        `
        UPDATE transfer_job_items
           SET state = $2,
               updated_at = now()
         WHERE id = $1
           AND worker_id = $3
           AND state IN ('leased', 'uploading', 'captioning', 'publishing')
        `,
        [itemId, next, workerId],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new Error(
          `processTransferItemDummy: lease stolen from worker ${workerId} at state ${next}`,
        );
      }
    }

    // Clear the lease on terminal transition — keeps the lease-
    // coherence CHECK satisfied (succeeded must have worker_id NULL +
    // lease_expires_at NULL).
    await c.query(
      `
      UPDATE transfer_job_items
         SET worker_id = NULL,
             lease_expires_at = NULL,
             updated_at = now()
       WHERE id = $1
         AND state = 'succeeded'
      `,
      [itemId],
    );

    // Job-aggregation UPDATE: bump the parent's succeeded_count and
    // flip status to 'succeeded' when every item in the job has
    // reached a terminal state. Top-branch CASE preserves 'cancelled'
    // and 'failed' so a late-succeeding item doesn't flip back.
    await c.query(
      `
      WITH counts AS (
        SELECT transfer_job_id,
               count(*) FILTER (WHERE state = 'succeeded') AS succeeded,
               count(*) FILTER (WHERE state = 'failed')    AS failed,
               count(*) FILTER (WHERE state = 'skipped')   AS skipped,
               count(*) AS total
          FROM transfer_job_items
         WHERE transfer_job_id = (
           SELECT transfer_job_id FROM transfer_job_items WHERE id = $1
         )
         GROUP BY transfer_job_id
      )
      UPDATE transfer_jobs j
         SET succeeded_count = c.succeeded,
             failed_count    = c.failed,
             skipped_count   = c.skipped,
             status = CASE
               WHEN j.status IN ('cancelled', 'failed') THEN j.status
               WHEN (c.succeeded + c.failed + c.skipped) >= j.requested_count
                 THEN CASE WHEN c.failed > 0 THEN 'failed' ELSE 'succeeded' END
               ELSE 'processing'
             END,
             finished_at = CASE
               WHEN j.status IN ('cancelled', 'failed') THEN j.finished_at
               WHEN (c.succeeded + c.failed + c.skipped) >= j.requested_count
                 THEN COALESCE(j.finished_at, now())
               ELSE j.finished_at
             END,
             started_at = COALESCE(j.started_at, now()),
             updated_at = now()
        FROM counts c
       WHERE j.id = c.transfer_job_id
      `,
      [itemId],
    );
  });
}

// ---------------------------------------------------------------------------
// M4-4 — Anthropic vision caption stage.
//
// Advances a leased cloudflare_ingest item through:
//   leased → captioning → (Anthropic vision call) → succeeded | failed
//
// The caption stage is the second external-call stage in a
// cloudflare_ingest item's lifecycle. M4-3's upload stage runs first and
// sets image_library.cloudflare_id plus the item's image_id. This stage
// reads the image via its public URL (source_url on the item for M4-4;
// in production this becomes the Cloudflare-delivered URL once M4-3
// lands), calls Anthropic with the item's pre-computed
// anthropic_idempotency_key, parses the JSON response, and writes the
// caption fields back to image_library.
//
// Write-safety contract (per docs/patterns/new-batch-worker-stage.md +
// background-worker-with-write-safety.md):
//
//   1. Event-log first. The `anthropic_caption_response_received` event
//      is written BEFORE the image_library UPDATE and BEFORE the slot
//      state flip. Reconciliation rebuilds cost from transfer_events
//      even if a later UPDATE fails.
//
//   2. Idempotency-Key stability. The item's anthropic_idempotency_key
//      is passed through unchanged; a retry (post-reap) replays the
//      same key. Anthropic's idempotency cache returns the original
//      response without re-billing.
//
//   3. Lease coherence. Every UPDATE to transfer_job_items includes
//      worker_id = $workerId AND state IN (<intermediate set>). A
//      reaped-and-relet item rejects this worker's late writes — the
//      rowCount=0 check throws.
//
//   4. Cost captured even on terminal failure. Parse / validation
//      failures still bill (we paid for the tokens). Non-retryable
//      API errors that did NOT bill (4xx before token usage) write
//      cost_cents=0.
//
//   5. Retryable vs non-retryable. Retryable failures (429, 5xx, net)
//      reset the item to 'pending' with retry_after set per the M3-7
//      backoff table. Non-retryable (4xx, parse, validation) go terminal
//      with state='failed' + failure_code.
// ---------------------------------------------------------------------------

// How to derive the image URL passed to Anthropic. For M4-4 in isolation
// we use transfer_job_items.source_url — that's what M4-5's iStock
// ingest seeds. Once M4-3 lands and populates image_library.cloudflare_id,
// this will extend to prefer the Cloudflare-delivered URL. Decision lives
// here in code so the override is localised to one swap.
function resolveCaptionUrl(item: {
  source_url: string | null;
}): string | null {
  return item.source_url;
}

// Build the retry_after timestamp for a retryable failure. retry_count
// was already bumped on lease acquisition (migration 0010 + worker core
// contract), so backing off uses the retry_count as-stored.
function retryAfterForCount(retryCount: number): Date | null {
  const delayMs = RETRY_BACKOFF_MS[retryCount];
  if (delayMs == null) return null;
  return new Date(Date.now() + delayMs);
}

export type CaptionProcessorOptions = {
  client?: Client | null;
  captionCall?: AnthropicCaptionCallFn;
  model?: string;
  maxTokens?: number;
};

/**
 * Production caption processor for a leased transfer_job_items row.
 *
 * Contract:
 *   - Caller has already invoked leaseNextTransferItem and holds the
 *     lease under `workerId`.
 *   - Item's image_id references an image_library row. Callers driving
 *     M4-4 in isolation (pre-M4-3) are responsible for pre-inserting
 *     that row; M4-3's upload stage will do it automatically once
 *     shipped.
 *   - Item's source_url is set to a publicly-fetchable URL (iStock for
 *     the seed, Cloudflare for re-captioning runs post-M4-3).
 *
 * Walks the state machine leased → captioning → succeeded on the happy
 * path, leased → captioning → failed on terminal error, or resets to
 * pending (with retry_after) on retryable error.
 */
export async function processTransferItemCaption(
  itemId: string,
  workerId: string,
  opts: CaptionProcessorOptions = {},
): Promise<void> {
  const captionCall = opts.captionCall ?? defaultAnthropicCaptionCall;
  const model = opts.model ?? CAPTION_MODEL;
  const maxTokens = opts.maxTokens ?? CAPTION_MAX_TOKENS;

  // Load the item's context from the service role — the caption URL,
  // image_id, anthropic_idempotency_key, transfer_job_id, retry_count.
  // Read-only; no lease-coherence guard needed on SELECT.
  const svc = getServiceRoleClient();
  const itemRes = await svc
    .from("transfer_job_items")
    .select(
      "id, transfer_job_id, image_id, source_url, anthropic_idempotency_key, retry_count",
    )
    .eq("id", itemId)
    .single();
  if (itemRes.error || !itemRes.data) {
    throw new Error(
      `processTransferItemCaption: load item: ${itemRes.error?.message ?? "no row"} for ${itemId}`,
    );
  }
  const itemRow = itemRes.data as {
    id: string;
    transfer_job_id: string;
    image_id: string | null;
    source_url: string | null;
    anthropic_idempotency_key: string;
    retry_count: number;
  };

  if (!itemRow.image_id) {
    throw new Error(
      `processTransferItemCaption: item ${itemId} has no image_id (M4-3 upload stage must run first)`,
    );
  }
  const imageUrl = resolveCaptionUrl(itemRow);
  if (!imageUrl) {
    throw new Error(
      `processTransferItemCaption: item ${itemId} has no source_url`,
    );
  }

  // leased → captioning. Event log first, then the state flip.
  await withClient(opts.client ?? null, async (c) => {
    await c.query(
      `
      INSERT INTO transfer_events (
        transfer_job_id, transfer_job_item_id, event_type, payload_jsonb
      )
      VALUES ($1, $2, 'anthropic_caption_started',
              jsonb_build_object('worker_id', $3::text,
                                 'image_url', $4::text,
                                 'model', $5::text))
      `,
      [itemRow.transfer_job_id, itemId, workerId, imageUrl, model],
    );
    const advance = await c.query(
      `
      UPDATE transfer_job_items
         SET state = 'captioning',
             updated_at = now()
       WHERE id = $1
         AND worker_id = $2
         AND state = 'leased'
      `,
      [itemId, workerId],
    );
    if ((advance.rowCount ?? 0) === 0) {
      throw new Error(
        `processTransferItemCaption: lease stolen from worker ${workerId} before Anthropic call`,
      );
    }
  });

  // Anthropic call. Released from the pg client — no connection held
  // during the round-trip. A throw here is either retryable (reset to
  // pending with retry_after) or non-retryable (terminal fail, cost
  // billable only if the call returned tokens which it didn't, so 0).
  let apiResponse;
  try {
    apiResponse = await captionCall({
      image_url: imageUrl,
      idempotency_key: itemRow.anthropic_idempotency_key,
      model,
      max_tokens: maxTokens,
    });
  } catch (err) {
    await handleCaptionApiError(
      itemRow,
      workerId,
      err,
      imageUrl,
      model,
      opts.client ?? null,
    );
    return;
  }

  // Cost computed before any DB writes so a commit failure still leaves
  // the audit log coherent (event will carry the cost; we can always
  // replay).
  const { cents, rateFound } = computeCostCents(apiResponse.model, apiResponse.usage);

  // Parse + structural validation. Parse failure / schema failure is
  // non-retryable and terminal — the same idempotency key would return
  // the same unparseable reply.
  let parsed: CaptionPayload | null = null;
  let parseError: CaptionCallError | null = null;
  try {
    parsed = parseCaptionPayload(apiResponse.raw_text);
  } catch (err) {
    if (err instanceof CaptionCallError) {
      parseError = err;
    } else {
      throw err;
    }
  }

  // Event log first. One event row with the full cost / usage / pricing
  // snapshot + the parse outcome so billing reconciliation can rebuild
  // without re-running the worker.
  await withClient(opts.client ?? null, async (c) => {
    await c.query(
      `
      INSERT INTO transfer_events (
        transfer_job_id, transfer_job_item_id, event_type, payload_jsonb, cost_cents
      )
      VALUES ($1, $2, 'anthropic_caption_response_received',
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
                'worker_id', $12::text,
                'parse_ok', $13::boolean,
                'parse_failure_code', $14::text
              ), $9)
      `,
      [
        itemRow.transfer_job_id,
        itemId,
        apiResponse.id,
        apiResponse.model,
        apiResponse.usage.input_tokens,
        apiResponse.usage.output_tokens,
        apiResponse.usage.cache_creation_input_tokens ?? 0,
        apiResponse.usage.cache_read_input_tokens ?? 0,
        cents,
        PRICING_VERSION,
        rateFound,
        workerId,
        parsed !== null,
        parseError?.code ?? null,
      ],
    );
  });

  if (parsed === null) {
    // Parse / validation failure. Mark item failed with cost recorded.
    await markCaptionFailed({
      itemRow,
      workerId,
      failureCode: parseError?.code ?? "CAPTION_PARSE_FAILED",
      failureDetail: parseError?.message ?? "parse failed",
      costCents: cents,
      client: opts.client ?? null,
    });
    return;
  }

  // Success path. image_library UPDATE, then item UPDATE, then job
  // aggregation. Each UPDATE is lease-coherent on the item.
  await withClient(opts.client ?? null, async (c) => {
    // Idempotent UPDATE — a replay with the same idempotency key returns
    // identical payload, so this becomes a no-op on second run. No
    // lease guard here (image_library has no per-row lease concept);
    // concurrent callers writing the same fields is prevented by the
    // FOR UPDATE lock the worker already holds on the transfer item.
    const updateImage = await c.query(
      `
      UPDATE image_library
         SET caption = $2,
             alt_text = $3,
             tags = $4::text[],
             updated_at = now()
       WHERE id = $1
      `,
      [itemRow.image_id, parsed.caption, parsed.alt_text, parsed.tags],
    );
    if ((updateImage.rowCount ?? 0) === 0) {
      throw new Error(
        `processTransferItemCaption: image_library row ${itemRow.image_id} not found`,
      );
    }

    // captioning → succeeded on the item, + cost.
    const advance = await c.query(
      `
      UPDATE transfer_job_items
         SET state = 'succeeded',
             cost_cents = cost_cents + $3::bigint,
             worker_id = NULL,
             lease_expires_at = NULL,
             updated_at = now()
       WHERE id = $1
         AND worker_id = $2
         AND state = 'captioning'
      `,
      [itemId, workerId, cents],
    );
    if ((advance.rowCount ?? 0) === 0) {
      throw new Error(
        `processTransferItemCaption: lease stolen from worker ${workerId} before state=succeeded`,
      );
    }

    await c.query(
      `
      INSERT INTO transfer_events (
        transfer_job_id, transfer_job_item_id, event_type, payload_jsonb
      )
      VALUES ($1, $2, 'state_advanced',
              jsonb_build_object('to', 'succeeded',
                                 'worker_id', $3::text,
                                 'processor', 'caption'))
      `,
      [itemRow.transfer_job_id, itemId, workerId],
    );

    await aggregateJobProgress(c, itemId, cents);
  });
}

async function handleCaptionApiError(
  itemRow: {
    id: string;
    transfer_job_id: string;
    retry_count: number;
  },
  workerId: string,
  err: unknown,
  imageUrl: string,
  model: string,
  client: Client | null,
): Promise<void> {
  const isCaptionErr = err instanceof CaptionCallError;
  const retryable = isCaptionErr ? err.retryable : true;
  const code = isCaptionErr ? err.code : "ANTHROPIC_NETWORK_ERROR";
  const detail = err instanceof Error ? err.message : String(err);

  await withClient(client, async (c) => {
    // Audit event first — every attempt contributes one failure event
    // so reconciliation can count attempts even when retries succeed.
    await c.query(
      `
      INSERT INTO transfer_events (
        transfer_job_id, transfer_job_item_id, event_type, payload_jsonb
      )
      VALUES ($1, $2, 'anthropic_caption_failed',
              jsonb_build_object('worker_id', $3::text,
                                 'image_url', $4::text,
                                 'model', $5::text,
                                 'failure_code', $6::text,
                                 'failure_detail', $7::text,
                                 'retryable', $8::boolean,
                                 'retry_count', $9::int))
      `,
      [
        itemRow.transfer_job_id,
        itemRow.id,
        workerId,
        imageUrl,
        model,
        code,
        detail,
        retryable,
        itemRow.retry_count,
      ],
    );

    if (retryable) {
      const retryAfter = retryAfterForCount(itemRow.retry_count);
      if (retryAfter) {
        // Put it back in the queue with a backoff.
        const reset = await c.query(
          `
          UPDATE transfer_job_items
             SET state = 'pending',
                 worker_id = NULL,
                 lease_expires_at = NULL,
                 retry_after = $3::timestamptz,
                 failure_code = NULL,
                 failure_detail = NULL,
                 updated_at = now()
           WHERE id = $1
             AND worker_id = $2
             AND state IN ('leased', 'captioning')
          `,
          [itemRow.id, workerId, retryAfter.toISOString()],
        );
        if ((reset.rowCount ?? 0) === 0) {
          throw new Error(
            `processTransferItemCaption: lease stolen while deferring item ${itemRow.id}`,
          );
        }
        return;
      }
      // Retry budget exhausted — convert to terminal failure below.
    }

    // Terminal failure. cost_cents is left untouched; this branch fires
    // when the call never returned tokens (network / 4xx before billing).
    const fail = await c.query(
      `
      UPDATE transfer_job_items
         SET state = 'failed',
             failure_code = $3,
             failure_detail = $4,
             worker_id = NULL,
             lease_expires_at = NULL,
             updated_at = now()
       WHERE id = $1
         AND worker_id = $2
         AND state IN ('leased', 'captioning')
      `,
      [itemRow.id, workerId, code, detail],
    );
    if ((fail.rowCount ?? 0) === 0) {
      throw new Error(
        `processTransferItemCaption: lease stolen while marking item ${itemRow.id} failed`,
      );
    }

    await aggregateJobProgress(c, itemRow.id, 0);
  });
}

async function markCaptionFailed(params: {
  itemRow: { id: string; transfer_job_id: string };
  workerId: string;
  failureCode: string;
  failureDetail: string;
  costCents: number;
  client: Client | null;
}): Promise<void> {
  const { itemRow, workerId, failureCode, failureDetail, costCents, client } =
    params;

  await withClient(client, async (c) => {
    const fail = await c.query(
      `
      UPDATE transfer_job_items
         SET state = 'failed',
             cost_cents = cost_cents + $4::bigint,
             failure_code = $3,
             failure_detail = $5,
             worker_id = NULL,
             lease_expires_at = NULL,
             updated_at = now()
       WHERE id = $1
         AND worker_id = $2
         AND state IN ('leased', 'captioning')
      `,
      [itemRow.id, workerId, failureCode, costCents, failureDetail],
    );
    if ((fail.rowCount ?? 0) === 0) {
      throw new Error(
        `processTransferItemCaption: lease stolen while marking item ${itemRow.id} failed (${failureCode})`,
      );
    }

    await c.query(
      `
      INSERT INTO transfer_events (
        transfer_job_id, transfer_job_item_id, event_type, payload_jsonb, cost_cents
      )
      VALUES ($1, $2, 'state_advanced',
              jsonb_build_object('to', 'failed',
                                 'worker_id', $3::text,
                                 'failure_code', $4::text,
                                 'processor', 'caption'),
              $5::bigint)
      `,
      [itemRow.transfer_job_id, itemRow.id, workerId, failureCode, costCents],
    );

    await aggregateJobProgress(c, itemRow.id, costCents);
  });
}

// Shared job-aggregation UPDATE. Bumps total_cost_usd_cents and flips
// parent status according to the top-branch CASE (cancelled/failed stay
// terminal). Mirrors processTransferItemDummy's aggregation block with
// the addition of cost accumulation.
async function aggregateJobProgress(
  c: Client,
  itemId: string,
  costDeltaCents: number,
): Promise<void> {
  await c.query(
    `
    WITH counts AS (
      SELECT transfer_job_id,
             count(*) FILTER (WHERE state = 'succeeded') AS succeeded,
             count(*) FILTER (WHERE state = 'failed')    AS failed,
             count(*) FILTER (WHERE state = 'skipped')   AS skipped,
             count(*) AS total
        FROM transfer_job_items
       WHERE transfer_job_id = (
         SELECT transfer_job_id FROM transfer_job_items WHERE id = $1
       )
       GROUP BY transfer_job_id
    )
    UPDATE transfer_jobs j
       SET succeeded_count = c.succeeded,
           failed_count    = c.failed,
           skipped_count   = c.skipped,
           total_cost_usd_cents = total_cost_usd_cents + $2::bigint,
           status = CASE
             WHEN j.status IN ('cancelled', 'failed') THEN j.status
             WHEN (c.succeeded + c.failed + c.skipped) >= j.requested_count
               THEN CASE WHEN c.failed > 0 THEN 'failed' ELSE 'succeeded' END
             ELSE 'processing'
           END,
           finished_at = CASE
             WHEN j.status IN ('cancelled', 'failed') THEN j.finished_at
             WHEN (c.succeeded + c.failed + c.skipped) >= j.requested_count
               THEN COALESCE(j.finished_at, now())
             ELSE j.finished_at
           END,
           started_at = COALESCE(j.started_at, now()),
           updated_at = now()
      FROM counts c
     WHERE j.id = c.transfer_job_id
    `,
    [itemId, costDeltaCents],
  );
}
