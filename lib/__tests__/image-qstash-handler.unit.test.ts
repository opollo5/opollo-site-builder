import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────
const { mockVerify, mockPublishJSON } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockPublishJSON: vi.fn(),
}));

vi.mock("@/lib/qstash", () => ({
  verifyQstashSignature: mockVerify,
  getQstashClient: vi.fn(() => ({ publishJSON: mockPublishJSON })),
}));

const mockUpdate = vi.fn();
const mockSelect = vi.fn();
const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => ({ from: mockFrom })),
}));

const { mockGenerate } = vi.hoisted(() => ({ mockGenerate: vi.fn() }));
vi.mock("@/lib/image", () => ({ generateWithFallback: mockGenerate }));

const { mockAcquire, mockRelease, mockCount, mockCap } = vi.hoisted(() => ({
  mockAcquire: vi.fn(),
  mockRelease: vi.fn(),
  mockCount: vi.fn(),
  mockCap: vi.fn(),
}));
vi.mock("@/lib/image/lease", () => ({
  acquireImageLease: mockAcquire,
  releaseImageLease: mockRelease,
  getActiveLeaseCount: mockCount,
  getConcurrencyCap: mockCap,
  LEASE_TTL_SECONDS: 90,
  DEFAULT_CONCURRENCY_CAP: 12,
}));

vi.mock("@/lib/image/enqueue", () => ({
  enqueueImageJob: vi.fn().mockResolvedValue({ ok: true }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
// RFC 4122 v4 UUIDs (version=4, variant=8) — required by z.string().uuid() in Zod v4+
const JOB_UUID   = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BATCH_UUID   = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const VALID_PARAMS = {
  styleId: "clean_corporate",
  primaryColour: "#1a56db",
  compositionType: "split_layout",
  aspectRatio: "1x1",
  companyId: COMPANY_UUID,
};

function makeRequest(body: unknown, signature = "valid-sig"): Request {
  return new Request("http://localhost/api/internal/image/qstash-handler", {
    method: "POST",
    headers: { "upstash-signature": signature, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function buildFromMock(opts: {
  updateError?: string | null;
  runningCount?: number;
}) {
  return (table: string) => {
    if (table !== "image_generation_jobs") return { update: vi.fn(), select: vi.fn() };
    return {
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: opts.updateError ? { message: opts.updateError } : null }),
        }),
      }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ count: opts.runningCount ?? 1 }),
        }),
      }),
    };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────
import { POST } from "@/app/api/internal/image/qstash-handler/route";
// NextRequest not needed for test request construction — use plain Request (readable body in node env)

describe("POST /api/internal/image/qstash-handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerify.mockResolvedValue({ ok: true });
    mockAcquire.mockResolvedValue({ ok: true });
    mockRelease.mockResolvedValue(undefined);
    mockCount.mockResolvedValue(5);
    mockCap.mockReturnValue(12);
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.opollo.com";
  });

  it("returns 401 INVALID_SIGNATURE when signature is bad", async () => {
    mockVerify.mockResolvedValue({ ok: false, reason: "invalid" });
    const req = makeRequest({ jobId: JOB_UUID });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 503 RECEIVER_NOT_CONFIGURED when signing key is absent", async () => {
    mockVerify.mockResolvedValue({ ok: false, reason: "no_receiver" });
    const req = makeRequest({ jobId: JOB_UUID });
    const res = await POST(req);
    expect(res.status).toBe(503);
  });

  it("returns 200 duplicate when lease acquisition returns duplicate", async () => {
    mockVerify.mockResolvedValue({ ok: true });
    mockAcquire.mockResolvedValue({ ok: false, reason: "duplicate" });
    const body = { jobId: JOB_UUID, generationParams: VALID_PARAMS };
    const req = makeRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json() as { status: string };
    expect(json.status).toBe("duplicate");
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("re-enqueues with 30s delay and returns 200 when at concurrency cap", async () => {
    mockAcquire.mockResolvedValue({ ok: true });
    mockCount.mockResolvedValue(13); // above cap of 12
    mockCap.mockReturnValue(12);
    const { enqueueImageJob } = await import("@/lib/image/enqueue");

    const body = { jobId: JOB_UUID, generationParams: VALID_PARAMS };
    const req = makeRequest(body);
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json() as { status: string };
    expect(json.status).toBe("requeued");
    expect(vi.mocked(enqueueImageJob)).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: body.jobId, delaySeconds: 30 }),
    );
    expect(mockRelease).toHaveBeenCalledWith(body.jobId); // lease released before requeue
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("calls generateWithFallback and marks job completed on success", async () => {
    mockFrom.mockImplementation(buildFromMock({ runningCount: 1 }));
    mockGenerate.mockResolvedValue([{ storagePath: "co/generated/img.jpg", width: 1024, height: 1024, format: "jpeg" }]);

    const body = {
      jobId: JOB_UUID,
      generationParams: VALID_PARAMS,
    };
    const req = makeRequest(body);
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json() as { status: string; storagePath: string };
    expect(json.status).toBe("completed");
    expect(json.storagePath).toBe("co/generated/img.jpg");
    expect(mockRelease).toHaveBeenCalledWith(body.jobId); // released in finally
  });

  it("marks job failed and releases lease when generateWithFallback throws", async () => {
    mockFrom.mockImplementation(buildFromMock({ runningCount: 1 }));
    mockGenerate.mockRejectedValue(new Error("Ideogram 500: server error"));

    const body = {
      jobId: JOB_UUID,
      generationParams: VALID_PARAMS,
    };
    const req = makeRequest(body);
    const res = await POST(req);

    expect(res.status).toBe(200); // generation failures are permanent; don't ask QStash to retry
    const json = await res.json() as { ok: boolean; status: string };
    expect(json.ok).toBe(false);
    expect(json.status).toBe("failed");
    expect(mockRelease).toHaveBeenCalledWith(body.jobId); // released in finally even on error
  });

  it("returns 400 when body is malformed", async () => {
    const req = makeRequest({ jobId: "not-a-uuid" }); // missing generationParams, invalid uuid format doesn't matter
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
