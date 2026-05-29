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

// B3: batch dispatch now does a budget pre-flight against platform_companies
// + image_gen_spend before creating the batch row. Tests that exercise the
// dispatch happy-path need to mock these reads. Returning a healthy budget
// (1 million cents) keeps the budget check out of the assertion surface.
function budgetCheckPassesMock(table: string): Record<string, unknown> | undefined {
  if (table === "platform_companies") {
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { monthly_image_gen_budget_cents: 1_000_000 },
            error: null,
          }),
        }),
      }),
    };
  }
  if (table === "image_gen_spend") {
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    };
  }
  return undefined;
}

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
      const budgetMock = budgetCheckPassesMock(table);
      if (budgetMock) return budgetMock;
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

  it("returns 402 with structured payload when budget would be exceeded (B3)", async () => {
    mockFrom.mockImplementation((table: string) => {
      // Tight budget: 30 cents total, 0 spent → 6 jobs ($0.36) rejects.
      if (table === "platform_companies") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { monthly_image_gen_budget_cents: 30 },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "image_gen_spend") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    const req = makePostRequest({
      company_id: COMPANY_UUID,
      jobs: new Array(6).fill(VALID_JOB_SPEC),
      source_row_count: 2,
    }) as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(402);

    const json = (await res.json()) as {
      ok: boolean;
      error: {
        code: string;
        projected_jobs: number;
        projected_cents: number;
        source_row_count: number;
        remaining_cents: number;
        budget_cents: number;
        next_reset_at: string;
      };
    };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("BUDGET_EXCEEDED");
    expect(json.error.projected_jobs).toBe(6);
    expect(json.error.projected_cents).toBe(36);
    expect(json.error.source_row_count).toBe(2);
    expect(json.error.remaining_cents).toBe(30);
    expect(json.error.budget_cents).toBe(30);
    expect(json.error.next_reset_at).toMatch(/^\d{4}-\d{2}-01T/);

    // Budget rejection happens before the batch insert.
    const { enqueueImageJob } = await import("@/lib/image/enqueue");
    expect(vi.mocked(enqueueImageJob)).not.toHaveBeenCalled();
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
