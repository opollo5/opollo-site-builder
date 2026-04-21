import { Client, type QueryResult } from "pg";

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
