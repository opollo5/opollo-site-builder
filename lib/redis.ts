import { Redis } from "@upstash/redis";

// ---------------------------------------------------------------------------
// M10 — Upstash Redis REST client.
//
// Lazy singleton over `@upstash/redis`. The SDK speaks to Upstash's
// REST edge — no long-lived TCP connection, fits Vercel's
// request-scoped runtime. Returns null when env vars aren't set so
// tests + local dev stay no-op.
//
// Two envs required:
//   UPSTASH_REDIS_REST_URL     — https://<region>-<name>.upstash.io
//   UPSTASH_REDIS_REST_TOKEN   — per-database REST token
//
// Callers (rate limiter, health probe, self-probe) check for null
// before using and fall back to in-memory / graceful-degrade paths.
// ---------------------------------------------------------------------------

let cached: Redis | null | undefined = undefined;

export function getRedisClient(): Redis | null {
  if (cached !== undefined) return cached;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    cached = null;
    return null;
  }
  cached = new Redis({ url, token });
  return cached;
}

/**
 * Reset helper — exposed only for tests that need to re-evaluate the
 * env vars after mutation.
 */
export function __resetRedisClientForTests(): void {
  cached = undefined;
}
