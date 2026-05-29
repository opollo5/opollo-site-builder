import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { mockGate } = vi.hoisted(() => ({ mockGate: vi.fn() }));
vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: mockGate,
}));

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => ({ from: mockFrom })),
}));

const { mockAutoAttach } = vi.hoisted(() => ({ mockAutoAttach: vi.fn() }));
vi.mock("@/lib/image/auto-attach", () => ({
  autoAttachImage: mockAutoAttach,
}));

const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SELECTION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function makeRequest(method: "POST" | "PATCH", body: unknown): Request {
  return new Request(`http://localhost/api/platform/image/jobs/${JOB_ID}/select`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function configureFrom(opts: {
  jobOwner?: { company_id: string } | null;
  selectionInsertError?: string | null;
} = {}): void {
  const jobOwner = opts.jobOwner === undefined ? { company_id: COMPANY_ID } : opts.jobOwner;
  mockFrom.mockImplementation((table: string) => {
    if (table === "image_generation_jobs") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: jobOwner, error: null }),
          }),
        }),
      };
    }
    if (table === "image_selections") {
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: opts.selectionInsertError ? null : { id: SELECTION_ID },
              error: opts.selectionInsertError ? { message: opts.selectionInsertError } : null,
            }),
          }),
        }),
      };
    }
    return {};
  });
}

import { POST, PATCH } from "@/app/api/platform/image/jobs/[id]/select/route";
import type { NextRequest } from "next/server";

beforeEach(() => {
  vi.clearAllMocks();
  mockGate.mockResolvedValue({ kind: "allow", userId: USER_ID });
  mockAutoAttach.mockResolvedValue({ state: "attached", draftId: "draft-1", assetId: "asset-1" });
});

describe("POST /api/platform/image/jobs/[id]/select (approve)", () => {
  it("returns 400 when job not found", async () => {
    configureFrom({ jobOwner: null });
    const req = makeRequest("POST", {}) as unknown as NextRequest;
    const res = await POST(req, { params: { id: JOB_ID } });
    expect(res.status).toBe(400);
  });

  it("returns auth gate denial verbatim", async () => {
    configureFrom();
    mockGate.mockResolvedValue({
      kind: "deny",
      response: new Response(JSON.stringify({ ok: false }), { status: 403 }),
    });
    const req = makeRequest("POST", {}) as unknown as NextRequest;
    const res = await POST(req, { params: { id: JOB_ID } });
    expect(res.status).toBe(403);
    expect(mockAutoAttach).not.toHaveBeenCalled();
  });

  it("inserts image_selections row with selected=true and fires auto-attach", async () => {
    configureFrom();
    const req = makeRequest("POST", { reason: "looks great" }) as unknown as NextRequest;
    const res = await POST(req, { params: { id: JOB_ID } });
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      ok: boolean;
      data: { selected: boolean; autoAttach: { state: string; draftId?: string } };
    };
    expect(json.ok).toBe(true);
    expect(json.data.selected).toBe(true);
    expect(json.data.autoAttach.state).toBe("attached");
    expect(json.data.autoAttach.draftId).toBe("draft-1");

    expect(mockAutoAttach).toHaveBeenCalledWith({
      jobId: JOB_ID,
      companyId: COMPANY_ID,
      approvedBy: USER_ID,
    });
  });

  it("returns autoAttach.state='not_applicable' when job has no publish date", async () => {
    configureFrom();
    mockAutoAttach.mockResolvedValue({ state: "not_applicable" });
    const req = makeRequest("POST", {}) as unknown as NextRequest;
    const res = await POST(req, { params: { id: JOB_ID } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { autoAttach: { state: string } } };
    expect(json.data.autoAttach.state).toBe("not_applicable");
  });

  it("attach throws → selection still succeeds; returns autoAttach.state='attach_failed'", async () => {
    configureFrom();
    mockAutoAttach.mockRejectedValue(new Error("boom"));
    const req = makeRequest("POST", {}) as unknown as NextRequest;
    const res = await POST(req, { params: { id: JOB_ID } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; data: { autoAttach: { state: string } } };
    expect(json.ok).toBe(true);
    expect(json.data.autoAttach.state).toBe("attach_failed");
  });
});

describe("PATCH /api/platform/image/jobs/[id]/select (reject)", () => {
  it("returns 400 when reason missing", async () => {
    configureFrom();
    const req = makeRequest("PATCH", {}) as unknown as NextRequest;
    const res = await PATCH(req, { params: { id: JOB_ID } });
    expect(res.status).toBe(400);
  });

  it("inserts image_selections row with selected=false + rejection_reason; never fires auto-attach", async () => {
    configureFrom();
    const req = makeRequest("PATCH", { reason: "off-brand colour" }) as unknown as NextRequest;
    const res = await PATCH(req, { params: { id: JOB_ID } });
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      ok: boolean;
      data: { selected: boolean; rejectionReason: string };
    };
    expect(json.ok).toBe(true);
    expect(json.data.selected).toBe(false);
    expect(json.data.rejectionReason).toBe("off-brand colour");

    expect(mockAutoAttach).not.toHaveBeenCalled();
  });
});
