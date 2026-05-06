import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// M15-6 #19 — lib/redis.ts unit tests.
//
// getRedisClient() is a lazy singleton over @upstash/redis. The contract:
//   1. Returns null when UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN
//      is absent — callers degrade gracefully.
//   2. Returns the same Redis instance on every call after the first
//      (cached — no re-instantiation on every request).
//   3. __resetRedisClientForTests() clears the cache so tests can re-test
//      the instantiation path with different env vars without stale state.
//
// We mock @upstash/redis so no real Upstash connection is required in CI.
// The mock records constructor arguments to verify the client is built with
// the correct URL + token pulled from env.
// ---------------------------------------------------------------------------

// vi.mock is hoisted before variable declarations, so the factory must not
// reference file-scope consts. vi.hoisted() runs early enough to be safe.
const { mockRedisConstructor } = vi.hoisted(() => ({
  mockRedisConstructor: vi.fn().mockImplementation((opts: object) => opts),
}));

vi.mock("@upstash/redis", () => ({
  Redis: mockRedisConstructor,
}));

import {
  __resetRedisClientForTests,
  getRedisClient,
} from "@/lib/redis";

const ORIGINAL_URL = process.env.UPSTASH_REDIS_REST_URL;
const ORIGINAL_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

beforeEach(() => {
  mockRedisConstructor.mockClear();
  __resetRedisClientForTests();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

afterEach(() => {
  if (ORIGINAL_URL === undefined) {
    delete process.env.UPSTASH_REDIS_REST_URL;
  } else {
    process.env.UPSTASH_REDIS_REST_URL = ORIGINAL_URL;
  }
  if (ORIGINAL_TOKEN === undefined) {
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  } else {
    process.env.UPSTASH_REDIS_REST_TOKEN = ORIGINAL_TOKEN;
  }
  __resetRedisClientForTests();
});

describe("getRedisClient", () => {
  describe("when env vars are absent", () => {
    it("returns null when both vars are missing", () => {
      expect(getRedisClient()).toBeNull();
    });

    it("returns null when only URL is set", () => {
      process.env.UPSTASH_REDIS_REST_URL = "https://redis.upstash.io";
      expect(getRedisClient()).toBeNull();
    });

    it("returns null when only TOKEN is set", () => {
      process.env.UPSTASH_REDIS_REST_TOKEN = "tok_abc";
      expect(getRedisClient()).toBeNull();
    });

    it("does not instantiate Redis when vars are absent", () => {
      getRedisClient();
      expect(mockRedisConstructor).not.toHaveBeenCalled();
    });
  });

  describe("when env vars are present", () => {
    beforeEach(() => {
      process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
      process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token-123";
    });

    it("returns a non-null client", () => {
      expect(getRedisClient()).not.toBeNull();
    });

    it("instantiates Redis with the correct URL and token", () => {
      getRedisClient();
      expect(mockRedisConstructor).toHaveBeenCalledOnce();
      expect(mockRedisConstructor).toHaveBeenCalledWith({
        url: "https://fake.upstash.io",
        token: "fake-token-123",
      });
    });

    it("returns the same cached instance on repeated calls", () => {
      const first = getRedisClient();
      const second = getRedisClient();
      expect(first).toBe(second);
      expect(mockRedisConstructor).toHaveBeenCalledOnce();
    });
  });

  describe("caching behaviour", () => {
    it("caches null and does not retry even if vars are later added", () => {
      // First call: no vars → caches null.
      expect(getRedisClient()).toBeNull();
      // Add vars after the cache is set — should still return null (cached).
      process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
      process.env.UPSTASH_REDIS_REST_TOKEN = "tok";
      expect(getRedisClient()).toBeNull();
    });
  });
});

describe("__resetRedisClientForTests", () => {
  it("clears the cache so a subsequent call re-evaluates env vars", () => {
    // First call with no vars → caches null.
    expect(getRedisClient()).toBeNull();

    // Reset the cache, then add vars.
    __resetRedisClientForTests();
    process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "tok2";

    // Now a fresh call should instantiate Redis.
    expect(getRedisClient()).not.toBeNull();
    expect(mockRedisConstructor).toHaveBeenCalledOnce();
  });
});
