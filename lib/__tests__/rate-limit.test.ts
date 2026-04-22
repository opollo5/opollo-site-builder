import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// ---------------------------------------------------------------------------
// rate-limit.ts — unit tests.
//
// @upstash/ratelimit is stubbed to a deterministic counter so the tests
// don't need a live Upstash. getRedisClient() is also stubbed so we can
// flip between "configured" and "unconfigured" inside one file.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  // null = simulate "UPSTASH env unset → getRedisClient returns null".
  // non-null = simulate "configured".
  redisClient: { _fake: true } as unknown,
  // Overridable per-test behaviour for the stubbed Ratelimit.limit.
  limitImpl: ((_id: string) =>
    Promise.resolve({
      success: true,
      limit: 100,
      remaining: 99,
      reset: Date.now() + 60_000,
    })) as (id: string) => Promise<{
      success: boolean;
      limit: number;
      remaining: number;
      reset: number;
    }>,
  // Lets one test prove analytics+prefix survived the constructor call.
  constructedWith: [] as Array<{ prefix: string }>,
}));

vi.mock("@/lib/redis", () => ({
  getRedisClient: () => state.redisClient,
}));

vi.mock("@upstash/ratelimit", () => {
  class Ratelimit {
    prefix: string;
    constructor(opts: { prefix: string }) {
      this.prefix = opts.prefix;
      state.constructedWith.push({ prefix: opts.prefix });
    }
    limit(id: string) {
      return state.limitImpl(id);
    }
    static slidingWindow(_requests: number, _window: string) {
      return { kind: "slidingWindow" };
    }
  }
  return { Ratelimit };
});

import {
  __resetRateLimitForTests,
  checkRateLimit,
  getClientIp,
  rateLimitExceeded,
} from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

beforeEach(() => {
  state.redisClient = { _fake: true };
  state.constructedWith = [];
  state.limitImpl = (_id: string) =>
    Promise.resolve({
      success: true,
      limit: 100,
      remaining: 99,
      reset: Date.now() + 60_000,
    });
  __resetRateLimitForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkRateLimit — happy path + 429", () => {
  it("returns ok:true when the limiter reports success", async () => {
    const res = await checkRateLimit("chat", "user:A");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.remaining).toBe(99);
    }
  });

  it("returns ok:false with retryAfterSec when the limiter denies", async () => {
    state.limitImpl = () =>
      Promise.resolve({
        success: false,
        limit: 120,
        remaining: 0,
        reset: Date.now() + 25_000,
      });
    const res = await checkRateLimit("chat", "user:A");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.limit).toBe(120);
      expect(res.retryAfterSec).toBeGreaterThan(0);
      expect(res.retryAfterSec).toBeLessThanOrEqual(25);
    }
  });

  it("computes retryAfterSec as at least 1 even when reset is in the past", async () => {
    state.limitImpl = () =>
      Promise.resolve({
        success: false,
        limit: 10,
        remaining: 0,
        reset: Date.now() - 5_000,
      });
    const res = await checkRateLimit("login", "ip:1.2.3.4");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.retryAfterSec).toBe(1);
  });
});

describe("checkRateLimit — per-identifier isolation", () => {
  it("routes different identifiers to independent buckets", async () => {
    // The stub doesn't care about state across identifiers; we assert
    // that both calls go through without interfering. The module
    // doesn't maintain any per-identifier state of its own — all
    // bucketing lives in Upstash — so we prove the wiring passes the
    // identifier into `limit()` unmodified.
    const seen: string[] = [];
    state.limitImpl = (id) => {
      seen.push(id);
      return Promise.resolve({
        success: true,
        limit: 100,
        remaining: 99,
        reset: Date.now() + 60_000,
      });
    };

    await checkRateLimit("chat", "user:A");
    await checkRateLimit("chat", "user:B");
    expect(seen).toEqual(["user:A", "user:B"]);
  });
});

describe("checkRateLimit — fail-open when Upstash not configured", () => {
  it("returns ok:true when getRedisClient returns null (no env)", async () => {
    state.redisClient = null;
    __resetRateLimitForTests();
    const res = await checkRateLimit("chat", "user:A");
    expect(res.ok).toBe(true);
    expect(state.constructedWith).toEqual([]);
  });

  it("logs a single debug on the first miss, then silent", async () => {
    const debugSpy = vi.spyOn(logger, "debug");
    state.redisClient = null;
    __resetRateLimitForTests();
    await checkRateLimit("chat", "user:A");
    await checkRateLimit("batch", "user:B");
    await checkRateLimit("regen", "user:C");
    expect(debugSpy).toHaveBeenCalledTimes(1);
  });
});

describe("checkRateLimit — fail-open when Upstash throws", () => {
  it("returns ok:true and logs one warn when limit() rejects", async () => {
    const warnSpy = vi.spyOn(logger, "warn");
    state.limitImpl = () => Promise.reject(new Error("upstash down"));
    const res = await checkRateLimit("chat", "user:A");
    expect(res.ok).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // The warn carries the limiter name + identifier for triage.
    const call = warnSpy.mock.calls[0];
    expect(call[0]).toMatch(/rate-limit/i);
    expect(call[1]).toMatchObject({ limiter: "chat", identifier: "user:A" });
  });
});

describe("checkRateLimit — instance caching", () => {
  it("constructs a Ratelimit once per name across calls", async () => {
    await checkRateLimit("chat", "user:A");
    await checkRateLimit("chat", "user:B");
    await checkRateLimit("chat", "user:C");
    // One `chat` limiter constructed, not three.
    const chatInstances = state.constructedWith.filter(
      (c) => c.prefix === "rl:chat",
    );
    expect(chatInstances).toHaveLength(1);
  });

  it("uses a distinct prefix per named limiter", async () => {
    await checkRateLimit("chat", "user:A");
    await checkRateLimit("batch", "user:A");
    await checkRateLimit("login", "ip:1.2.3.4");
    const prefixes = state.constructedWith.map((c) => c.prefix);
    expect(new Set(prefixes)).toEqual(
      new Set(["rl:chat", "rl:batch", "rl:login"]),
    );
  });
});

describe("rateLimitExceeded — response shape", () => {
  it("returns a 429 with the standard envelope + Retry-After header", async () => {
    const res = rateLimitExceeded({
      ok: false,
      limit: 60,
      remaining: 0,
      reset: Date.now() + 30_000,
      retryAfterSec: 30,
    });

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(res.headers.get("X-RateLimit-Limit")).toBe("60");
    expect(res.headers.get("X-RateLimit-Reset")).not.toBeNull();

    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.retryable).toBe(true);
    expect(body.error.message).toMatch(/30 seconds/);
    expect(body.error.suggested_action).toBeTruthy();
    expect(body.timestamp).toBeTruthy();
  });
});

describe("getClientIp", () => {
  it("reads the first entry of x-forwarded-for", () => {
    const req = new Request("http://t/", {
      headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1, 192.168.1.1" },
    });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const req = new Request("http://t/", {
      headers: { "x-real-ip": "5.6.7.8" },
    });
    expect(getClientIp(req)).toBe("5.6.7.8");
  });

  it("returns 'unknown' when neither header is present", () => {
    const req = new Request("http://t/");
    expect(getClientIp(req)).toBe("unknown");
  });

  it("trims whitespace from the first xff entry", () => {
    const req = new Request("http://t/", {
      headers: { "x-forwarded-for": "  1.2.3.4  , 10.0.0.1" },
    });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });
});
