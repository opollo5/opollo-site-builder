import "server-only";

import { getRedisClient } from "@/lib/redis";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// B1 Redis lease — per-job concurrency tracking for the QStash image handler.
//
// Each in-flight Ideogram call holds a TTL-based lease key so that:
//   (a) Duplicate QStash deliveries of the same jobId are absorbed (NX fails
//       because the key already exists → handler returns 200 no-op).
//   (b) The active-lease count enforces a soft concurrency cap so we don't
//       hammer Ideogram above its plan limit.
//
// Lease key: image-gen-lease:{jobId}
// TTL: 90s — safely longer than worst-case generation wall time (~51s p99).
//      If a worker crashes, the lease expires naturally; no slot is leaked
//      permanently. The finally-block DEL is belt-and-braces for the clean path.
//
// See docs/briefs/image-generator/MASS_IMAGE_GEN_BUILD_BRIEF.md §B1 / §7.4.
// ---------------------------------------------------------------------------

const LEASE_KEY_PREFIX = "image-gen-lease:";
export const LEASE_TTL_SECONDS = 90;
export const DEFAULT_CONCURRENCY_CAP = 12;

export function getConcurrencyCap(): number {
  return parseInt(process.env.IDEOGRAM_CONCURRENCY_CAP ?? String(DEFAULT_CONCURRENCY_CAP));
}

export type LeaseAcquireResult =
  | { ok: true }
  | { ok: false; reason: "duplicate" | "no_redis" };

/**
 * Attempt to acquire a lease for the given jobId.
 *
 * Returns `{ ok: false, reason: "duplicate" }` when the key already exists —
 * this is a duplicate QStash delivery of an in-flight job. The caller MUST
 * return HTTP 200 (idempotent no-op) so QStash stops retrying.
 *
 * Returns `{ ok: false, reason: "no_redis" }` when Redis is unconfigured.
 * Callers in that case should degrade gracefully (proceed without lease
 * enforcement, accepting that concurrency cap won't be upheld).
 */
export async function acquireImageLease(jobId: string): Promise<LeaseAcquireResult> {
  const redis = getRedisClient();
  if (!redis) {
    logger.warn("image.lease.no_redis", { jobId });
    return { ok: false, reason: "no_redis" };
  }

  const key = `${LEASE_KEY_PREFIX}${jobId}`;
  // SET NX EX: atomic "set only if not exists, with TTL".
  // Returns "OK" on success, null on NX failure (key already exists).
  const result = await redis.set(key, "1", { nx: true, ex: LEASE_TTL_SECONDS });

  if (result === null) {
    return { ok: false, reason: "duplicate" };
  }
  return { ok: true };
}

/**
 * Release the lease for the given jobId.
 * Called in a finally block — errors are logged but not rethrown.
 */
export async function releaseImageLease(jobId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.del(`${LEASE_KEY_PREFIX}${jobId}`);
  } catch (err) {
    logger.warn("image.lease.release_failed", {
      jobId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Count currently active leases by scanning the key prefix.
 * O(N) over the active lease key space — acceptable when cap ≤ 16.
 */
export async function getActiveLeaseCount(): Promise<number> {
  const redis = getRedisClient();
  if (!redis) return 0;
  const keys = await redis.keys(`${LEASE_KEY_PREFIX}*`);
  return keys.length;
}
