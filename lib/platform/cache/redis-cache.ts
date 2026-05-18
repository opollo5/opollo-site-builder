import "server-only";

import { getRedisClient } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { recordHealthEvent } from "@/lib/platform/service-health/record";

export async function redisGet(key: string): Promise<unknown | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  try {
    return await redis.get(key);
  } catch (err) {
    logger.warn("cache.redis_get_failed", { key, err: err instanceof Error ? err.message : String(err) });
    void recordHealthEvent({
      serviceName: "upstash-redis",
      operation: "cache.get",
      eventType: "service_5xx",
      severity: "warning",
      details: { key, message: err instanceof Error ? err.message : String(err) },
    });
    return null;
  }
}

export async function redisSet(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return false;
  try {
    await redis.set(key, JSON.stringify(value), { ex: ttlSeconds });
    return true;
  } catch (err) {
    logger.warn("cache.redis_set_failed", { key, err: err instanceof Error ? err.message : String(err) });
    void recordHealthEvent({
      serviceName: "upstash-redis",
      operation: "cache.set",
      eventType: "service_5xx",
      severity: "warning",
      details: { key, message: err instanceof Error ? err.message : String(err) },
    });
    return false;
  }
}
