import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// A5 — unit tests for triggerCAPImageGen (QStash dispatch version).
//
// After A5: the trigger no longer calls generateWithFallback() inline.
// It creates an image_generation_jobs row and enqueues to the QStash handler.
// All inline generation and asset-creation logic moved into the handler.
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/image", () => ({
  generateWithFallback: vi.fn(),
  getAllowedStyles: vi.fn().mockReturnValue(["clean_corporate"]),
}));

const { mockEnqueue } = vi.hoisted(() => ({ mockEnqueue: vi.fn() }));
vi.mock("@/lib/image/enqueue", () => ({ enqueueImageJob: mockEnqueue }));

vi.mock("@/lib/supabase", () => ({ getServiceRoleClient: vi.fn() }));

import { generateWithFallback } from "@/lib/image";
import { getServiceRoleClient } from "@/lib/supabase";
import { triggerCAPImageGen } from "@/lib/platform/social/cap/image-trigger";

function makeMockSvc(opts?: { jobInsertError?: boolean; jobUpdateError?: boolean }) {
  const mockJobSingle = vi.fn().mockResolvedValue(
    opts?.jobInsertError
      ? { data: null, error: { message: "insert failed" } }
      : { data: { id: "job-uuid-1" }, error: null },
  );
  const mockJobInsert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: mockJobSingle }) });

  const mockJobUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue(opts?.jobUpdateError ? { error: { message: "update failed" } } : { error: null }),
  });

  return {
    svc: {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "image_generation_jobs") {
          return { insert: mockJobInsert, update: mockJobUpdate };
        }
        return {};
      }),
    },
    mockJobInsert,
    mockJobUpdate,
  };
}

beforeEach(() => {
  process.env.IDEOGRAM_API_KEY = "test-key-not-real";
  process.env.QSTASH_TOKEN = "test-qstash-token";
  vi.clearAllMocks();
  mockEnqueue.mockResolvedValue({ ok: true });
});

describe("triggerCAPImageGen", () => {
  it("creates a job row and enqueues to QStash", async () => {
    const { svc, mockJobInsert } = makeMockSvc();
    vi.mocked(getServiceRoleClient).mockReturnValue(svc as never);

    await triggerCAPImageGen({ companyId: "company-id", draftId: "draft-id-1", brand: null });

    // Job row created
    expect(mockJobInsert).toHaveBeenCalledOnce();
    const insertArg = mockJobInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg).toMatchObject({ company_id: "company-id", state: "pending" });
    expect(insertArg.generation_params).toBeDefined();

    // Enqueued to QStash
    expect(mockEnqueue).toHaveBeenCalledOnce();
    const enqueueArg = mockEnqueue.mock.calls[0][0] as Record<string, unknown>;
    expect(enqueueArg.jobId).toBe("job-uuid-1");
    expect(enqueueArg.capDraftId).toBe("draft-id-1");
  });

  it("passes headlineText (first sentence of masterText, truncated 80 chars)", async () => {
    const { svc } = makeMockSvc();
    vi.mocked(getServiceRoleClient).mockReturnValue(svc as never);

    await triggerCAPImageGen({
      companyId: "c", draftId: "d", brand: null,
      masterText: "This is the first sentence. This is the second sentence.",
    });

    const enqueueArg = mockEnqueue.mock.calls[0][0] as Record<string, unknown>;
    expect(enqueueArg.headlineText).toBe("This is the first sentence");
  });

  it("truncates headlineText to 80 chars for square aspect ratio", async () => {
    const { svc } = makeMockSvc();
    vi.mocked(getServiceRoleClient).mockReturnValue(svc as never);
    const longSentence = "A".repeat(100);

    await triggerCAPImageGen({ companyId: "c", draftId: "d", brand: null, masterText: longSentence });

    const enqueueArg = mockEnqueue.mock.calls[0][0] as Record<string, unknown>;
    expect((enqueueArg.headlineText as string).length).toBeLessThanOrEqual(80);
  });

  it("does NOT call generateWithFallback inline — that is the handler's job", async () => {
    const { svc } = makeMockSvc();
    vi.mocked(getServiceRoleClient).mockReturnValue(svc as never);

    await triggerCAPImageGen({ companyId: "c", draftId: "d", brand: null });

    expect(generateWithFallback).not.toHaveBeenCalled();
  });

  it("skips silently when IDEOGRAM_API_KEY is unset", async () => {
    delete process.env.IDEOGRAM_API_KEY;
    const { svc, mockJobInsert } = makeMockSvc();
    vi.mocked(getServiceRoleClient).mockReturnValue(svc as never);

    await expect(triggerCAPImageGen({ companyId: "c", draftId: "d", brand: null })).resolves.toBeUndefined();

    expect(mockJobInsert).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("skips silently when QSTASH_TOKEN is unset", async () => {
    delete process.env.QSTASH_TOKEN;
    const { svc, mockJobInsert } = makeMockSvc();
    vi.mocked(getServiceRoleClient).mockReturnValue(svc as never);

    await expect(triggerCAPImageGen({ companyId: "c", draftId: "d", brand: null })).resolves.toBeUndefined();

    expect(mockJobInsert).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("marks job failed and returns without throwing when enqueue fails", async () => {
    mockEnqueue.mockResolvedValue({ ok: false, error: "QSTASH_TOKEN not set" });
    const { svc, mockJobUpdate } = makeMockSvc();
    vi.mocked(getServiceRoleClient).mockReturnValue(svc as never);

    await expect(triggerCAPImageGen({ companyId: "c", draftId: "d", brand: null })).resolves.toBeUndefined();

    // Job cleaned up to failed state
    expect(mockJobUpdate).toHaveBeenCalledOnce();
    const updateArg = mockJobUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg.state).toBe("failed");
  });

  it("returns without throwing when job row creation fails", async () => {
    const { svc } = makeMockSvc({ jobInsertError: true });
    vi.mocked(getServiceRoleClient).mockReturnValue(svc as never);

    await expect(triggerCAPImageGen({ companyId: "c", draftId: "d", brand: null })).resolves.toBeUndefined();

    // No enqueue if job creation failed
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
