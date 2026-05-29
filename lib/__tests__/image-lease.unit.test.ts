import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// ─────────────────────────────────────────────────────────────────────────────
// Mock Redis client
// ─────────────────────────────────────────────────────────────────────────────
const mockRedisSet = vi.fn();
const mockRedisDel = vi.fn();
const mockRedisKeys = vi.fn();
const mockRedis = { set: mockRedisSet, del: mockRedisDel, keys: mockRedisKeys };

vi.mock("@/lib/redis", () => ({
  getRedisClient: vi.fn(() => mockRedis),
  __resetRedisClientForTests: vi.fn(),
}));

import {
  acquireImageLease,
  releaseImageLease,
  getActiveLeaseCount,
  LEASE_TTL_SECONDS,
  DEFAULT_CONCURRENCY_CAP,
} from "@/lib/image/lease";

describe("acquireImageLease", () => {
  beforeEach(() => {
    mockRedisSet.mockReset();
    mockRedisDel.mockReset();
    mockRedisKeys.mockReset();
  });

  it("returns { ok: true } and calls SET NX EX 90 when key is new", async () => {
    mockRedisSet.mockResolvedValue("OK");
    const result = await acquireImageLease("job-uuid-1");
    expect(result).toEqual({ ok: true });
    expect(mockRedisSet).toHaveBeenCalledWith(
      "image-gen-lease:job-uuid-1",
      "1",
      { nx: true, ex: LEASE_TTL_SECONDS },
    );
    expect(LEASE_TTL_SECONDS).toBe(90);
  });

  it("returns { ok: false, reason: 'duplicate' } when key already exists (NX returns null)", async () => {
    mockRedisSet.mockResolvedValue(null);
    const result = await acquireImageLease("job-uuid-1");
    expect(result).toEqual({ ok: false, reason: "duplicate" });
  });

  it("returns { ok: false, reason: 'no_redis' } when Redis is unconfigured", async () => {
    const { getRedisClient } = await import("@/lib/redis");
    vi.mocked(getRedisClient).mockReturnValueOnce(null);
    const result = await acquireImageLease("job-uuid-2");
    expect(result).toEqual({ ok: false, reason: "no_redis" });
  });
});

describe("releaseImageLease", () => {
  beforeEach(() => mockRedisDel.mockReset());

  it("calls DEL with the correct key", async () => {
    mockRedisDel.mockResolvedValue(1);
    await releaseImageLease("job-uuid-3");
    expect(mockRedisDel).toHaveBeenCalledWith("image-gen-lease:job-uuid-3");
  });

  it("does not throw when Redis is unconfigured", async () => {
    const { getRedisClient } = await import("@/lib/redis");
    vi.mocked(getRedisClient).mockReturnValueOnce(null);
    await expect(releaseImageLease("job-uuid-4")).resolves.toBeUndefined();
  });

  it("does not throw when DEL errors — logs warning instead", async () => {
    const { getRedisClient } = await import("@/lib/redis");
    vi.mocked(getRedisClient).mockReturnValueOnce({
      ...mockRedis,
      del: vi.fn().mockRejectedValue(new Error("connection refused")),
    } as unknown as ReturnType<typeof getRedisClient>);
    await expect(releaseImageLease("job-uuid-5")).resolves.toBeUndefined();
  });
});

describe("getActiveLeaseCount", () => {
  beforeEach(() => mockRedisKeys.mockReset());

  it("returns the count of matching keys", async () => {
    mockRedisKeys.mockResolvedValue(["image-gen-lease:a", "image-gen-lease:b"]);
    const count = await getActiveLeaseCount();
    expect(count).toBe(2);
    expect(mockRedisKeys).toHaveBeenCalledWith("image-gen-lease:*");
  });

  it("returns 0 when no keys match", async () => {
    mockRedisKeys.mockResolvedValue([]);
    expect(await getActiveLeaseCount()).toBe(0);
  });

  it("returns 0 when Redis is unconfigured", async () => {
    const { getRedisClient } = await import("@/lib/redis");
    vi.mocked(getRedisClient).mockReturnValueOnce(null);
    expect(await getActiveLeaseCount()).toBe(0);
  });
});

describe("constants", () => {
  it("LEASE_TTL_SECONDS is 90", () => {
    expect(LEASE_TTL_SECONDS).toBe(90);
  });

  it("DEFAULT_CONCURRENCY_CAP is 12", () => {
    expect(DEFAULT_CONCURRENCY_CAP).toBe(12);
  });
});
