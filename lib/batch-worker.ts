import { Client, type QueryResult } from "pg";

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

      const candidate = await c.query<{ id: string }>(
        `
        SELECT id
          FROM generation_job_pages
         WHERE (
                 state = 'pending'
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
