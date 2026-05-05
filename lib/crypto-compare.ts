import { timingSafeEqual } from "node:crypto";

// Constant-time string comparison to prevent timing attacks on secret values
// (cron auth tokens, ops keys, emergency keys). Uses timingSafeEqual to
// ensure comparison time is independent of where strings differ.
export function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    const filler = Buffer.alloc(aBuf.length);
    timingSafeEqual(aBuf, filler);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}
