import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────
const { mockGate } = vi.hoisted(() => ({ mockGate: vi.fn() }));
vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: mockGate,
}));

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock("@/lib/image/enqueue", () => ({
  enqueueImageJob: vi.fn().mockResolvedValue({ ok: true }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const COMPANY_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BATCH_UUID   = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const JOB_UUID     = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const VALID_JOB_SPEC = {
  styleId: "clean_corporate",
  primaryColour: "#1a56db",
  compositionType: "split_layout",
  aspectRatio: "1x1",
};

function makePostRequest(body: unknown): Request {
  return new Request("http://localhost/api/platform/image/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/platform/image/batch
// ─────────────────────────────────────────────────────────────────────────────
import { POST } from "@/app/api/platform/image/batch/route";
import type { NextRequest } from "next/server";

describe("POST /api/platform/image/batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGate.mockResolvedValue({ kind: "allow", userId: "user-uuid-1" });
  });

  it("returns 400 when jobs array is empty", async () => {
    const req = makePostRequest({ company_id: COMPANY_UUID, jobs: [] }) as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 401 when auth gate denies", async () => {
    mockGate.mockResolvedValue({
      kind: "deny",
      response: new Response(JSON.stringify({ ok: false }), { status: 401 }),
    });
    const req = makePostRequest({ company_id: COMPANY_UUID, jobs: [VALID_JOB_SPEC] }) as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("creates batch + job and enqueues, returns 201 with batchId", async () => {
    const mockInsert = vi.fn();
    mockFrom.mockImplementation((table: string) => {
      if (table === "image_generation_batches") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: BATCH_UUID }, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        };
      }
      if (table === "image_generation_jobs") {
        mockInsert.mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: JOB_UUID }, error: null }),
          }),
        });
        return { insert: mockInsert };
      }
      return {};
    });

    const req = makePostRequest({
      company_id: COMPANY_UUID,
      jobs: [VALID_JOB_SPEC],
    }) as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(201);

    const json = await res.json() as { ok: boolean; data: { batchId: string; totalJobs: number } };
    expect(json.ok).toBe(true);
    expect(json.data.batchId).toBe(BATCH_UUID);
    expect(json.data.totalJobs).toBe(1);

    const { enqueueImageJob } = await import("@/lib/image/enqueue");
    expect(vi.mocked(enqueueImageJob)).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: JOB_UUID, batchId: BATCH_UUID }),
    );
  });

  it("mode=preview skips QStash enqueue", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "image_generation_batches") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: BATCH_UUID }, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        };
      }
      if (table === "image_generation_jobs") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: JOB_UUID }, error: null }),
            }),
          }),
        };
      }
      return {};
    });

    const req = makePostRequest({
      company_id: COMPANY_UUID,
      jobs: [VALID_JOB_SPEC],
      mode: "preview",
    }) as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(201);

    const json = await res.json() as { data: { mode: string } };
    expect(json.data.mode).toBe("preview");

    const { enqueueImageJob } = await import("@/lib/image/enqueue");
    expect(vi.mocked(enqueueImageJob)).not.toHaveBeenCalled();
  });
});
