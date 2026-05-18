import "server-only";

import { redisGet, redisSet } from "./redis-cache";
import {
  postgresGetAnalytics,
  postgresGetAnalyticsStale,
  postgresSetAnalytics,
  type AnalyticsCacheRow,
} from "./postgres-cache";

export type { AnalyticsCacheRow };

const ANALYTICS_REDIS_TTL = 60; // seconds

/**
 * Two-layer analytics cache: Upstash Redis hot + Postgres cold.
 *
 * getAnalytics()      — Redis (60s TTL) → Postgres (ttlSeconds) → null
 * setAnalytics()      — Redis + Postgres in parallel
 * getAnalyticsStale() — Redis → Postgres (no TTL filter) — for fallback on origin failure
 *
 * Never throws. All errors are caught and treated as cache misses.
 */

export async function getAnalytics(
  draftId: string,
  ttlSeconds = ANALYTICS_REDIS_TTL,
): Promise<AnalyticsCacheRow | null> {
  const redisKey = `analytics:${draftId}`;
  const hot = await redisGet(redisKey);
  if (hot !== null) {
    try {
      return (typeof hot === "string" ? JSON.parse(hot) : hot) as AnalyticsCacheRow;
    } catch {
      // corrupted entry — fall through
    }
  }
  return postgresGetAnalytics(draftId, ttlSeconds);
}

export async function setAnalytics(draftId: string, data: AnalyticsCacheRow): Promise<void> {
  const redisKey = `analytics:${draftId}`;
  await Promise.all([
    redisSet(redisKey, data, ANALYTICS_REDIS_TTL),
    postgresSetAnalytics(draftId, data),
  ]);
}

export async function getAnalyticsStale(draftId: string): Promise<AnalyticsCacheRow | null> {
  const redisKey = `analytics:${draftId}`;
  const hot = await redisGet(redisKey);
  if (hot !== null) {
    try {
      return (typeof hot === "string" ? JSON.parse(hot) : hot) as AnalyticsCacheRow;
    } catch {
      // fall through
    }
  }
  return postgresGetAnalyticsStale(draftId);
}
