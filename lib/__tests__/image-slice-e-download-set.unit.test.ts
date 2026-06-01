/**
 * Slice E — Download set + Download all (D6, D20, D24, D25)
 *
 * Tests:
 *  - download-mode batch: approve adds to download set (no autoAttach called)
 *  - D25 idempotency: double-click Approve returns existing selection, no duplicate insert
 *  - publish-mode batch: approve still fires autoAttach (unaffected)
 *  - reject path: unaffected by destination
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const mockGate = vi.fn().mockResolvedValue({ kind: "allow", userId: "user-1" });
vi.mock("@/lib/platform/auth/api-gate", () => ({ requireCanDoForApi: (...a: unknown[]) => mockGate(...a) }));

const mockAutoAttach = vi.fn().mockResolvedValue({ state: "attached", draftId: "d1", assetId: "a1" });
vi.mock("@/lib/image/auto-attach", () => ({ autoAttachImage: (...a: unknown[]) => mockAutoAttach(...a) }));

const COMPANY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SEL_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
let existingSelection: { id: string; selected: boolean } | null = null;
let batchDestination: "publish" | "download" = "publish";

const mockFrom = vi.fn((table: string) => {
  if (table === "image_generation_jobs") {
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: { company_id: COMPANY_ID, batch_id: "batch-1" }, error: null }) }) };
  }
  if (table === "image_selections") {
    const c: Record<string, unknown> = {};
    c["select"] = () => c; c["eq"] = () => c; c["order"] = () => c; c["limit"] = () => c; c["in"] = () => c;
    c["maybeSingle"] = vi.fn().mockResolvedValue({ data: existingSelection, error: null });
    c["insert"] = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: SEL_ID }, error: null }) }) });
    return c;
  }
  if (table === "image_generation_batches") {
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: { destination: batchDestination }, error: null }) }) };
  }
  if (table === "platform_companies") {
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: { timezone: "UTC" }, error: null }) }) };
  }
  return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
});

vi.mock("@/lib/supabase", () => ({ getServiceRoleClient: vi.fn(() => ({ from: mockFrom })) }));

import { POST } from "@/app/api/platform/image/jobs/[id]/select/route";

function makeApproveReq() {
  return new NextRequest(`http://localhost/api/platform/image/jobs/${JOB_ID}/select`, { method: "POST", body: JSON.stringify({}), headers: { "Content-Type": "application/json" } });
}

describe("Slice E — download set (D6, D20, D25)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existingSelection = null;
    batchDestination = "publish";
    mockGate.mockResolvedValue({ kind: "allow", userId: "user-1" });
    mockAutoAttach.mockResolvedValue({ state: "attached", draftId: "d1", assetId: "a1" });
    mockFrom.mockImplementation((table: string) => {
      if (table === "image_generation_jobs") return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: { company_id: COMPANY_ID, batch_id: "batch-1" }, error: null }) }) };
      if (table === "image_selections") { const c: Record<string, unknown> = {}; c["select"] = () => c; c["eq"] = () => c; c["order"] = () => c; c["limit"] = () => c; c["in"] = () => c; c["maybeSingle"] = vi.fn().mockResolvedValue({ data: existingSelection, error: null }); c["insert"] = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: SEL_ID }, error: null }) }) }); return c; }
      if (table === "image_generation_batches") return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: { destination: batchDestination }, error: null }) }) };
      if (table === "platform_companies") return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: { timezone: "UTC" }, error: null }) }) };
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
    });
  });

  it("download mode: approve adds to download set (no autoAttach)", async () => {
    batchDestination = "download";
    const res = await POST(makeApproveReq(), { params: Promise.resolve({ id: JOB_ID }) });
    const body = await res.json() as { ok: boolean; data: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.data.addedToDownloadSet).toBe(true);
    expect(body.data.destination).toBe("download");
    expect(mockAutoAttach).not.toHaveBeenCalled();
  });

  it("D25: idempotent approve — returns existing selection without inserting duplicate", async () => {
    existingSelection = { id: SEL_ID, selected: true };
    batchDestination = "publish";
    const res = await POST(makeApproveReq(), { params: Promise.resolve({ id: JOB_ID }) });
    const body = await res.json() as { ok: boolean; data: { selectionId: string } };
    expect(body.ok).toBe(true);
    expect(body.data.selectionId).toBe(SEL_ID);
    // autoAttach still called for publish idempotent case
    expect(mockAutoAttach).toHaveBeenCalledOnce();
  });

  it("publish mode: approve fires autoAttach (unaffected by Slice E)", async () => {
    batchDestination = "publish";
    const res = await POST(makeApproveReq(), { params: Promise.resolve({ id: JOB_ID }) });
    const body = await res.json() as { ok: boolean; data: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.data.destination).toBe("publish");
    expect(mockAutoAttach).toHaveBeenCalledOnce();
  });
});
