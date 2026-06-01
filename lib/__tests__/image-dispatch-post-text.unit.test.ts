/**
 * Unit tests for post_text persistence in dispatchImageBatch (migration 0170).
 *
 * Tests cover:
 *  - postTextByParentIndex is written to each job's post_text column
 *  - jobs sharing a parentPostIndex get the same caption
 *  - jobs with no entry in postTextByParentIndex get post_text=null
 *  - callers that don't pass postTextByParentIndex (template mode, mood board)
 *    get post_text=null — zero regression on existing callers
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// ─── Supabase chain ───────────────────────────────────────────────────────────
// Records every .insert() call so we can assert on what was written.

const insertedJobs: Array<Record<string, unknown>> = [];

const mockFrom = vi.fn((table: string) => {
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
  if (table === "image_generation_batches") {
    return {
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: "batch-uuid" }, error: null,
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    };
  }
  if (table === "image_generation_jobs") {
    return {
      insert: vi.fn((row: Record<string, unknown>) => {
        insertedJobs.push(row);
        return {
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: `job-${insertedJobs.length}` }, error: null,
            }),
          }),
        };
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    };
  }
  return { insert: vi.fn(), select: vi.fn(), update: vi.fn() };
});

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock("@/lib/image/enqueue", () => ({
  enqueueImageJob: vi.fn().mockResolvedValue({ ok: true }),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { dispatchImageBatch } from "@/lib/image/dispatch";

const COMPANY_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const BASE_SPEC = {
  styleId: "clean_corporate" as const,
  primaryColour: "#123456",
  compositionType: "split_layout" as const,
  aspectRatio: "1x1" as const,
};

beforeEach(() => {
  insertedJobs.length = 0;
  vi.clearAllMocks();
  // Re-wire mockFrom after clearAllMocks
  mockFrom.mockImplementation((table: string) => {
    if (table === "platform_companies") {
      return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: { monthly_image_gen_budget_cents: 1_000_000 }, error: null }) }) }) };
    }
    if (table === "image_gen_spend") {
      return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) }) };
    }
    if (table === "image_generation_batches") {
      return { insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "batch-uuid" }, error: null }) }) }), update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) };
    }
    if (table === "image_generation_jobs") {
      return {
        insert: vi.fn((row: Record<string, unknown>) => {
          insertedJobs.push(row);
          return { select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: `job-${insertedJobs.length}` }, error: null }) }) };
        }),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      };
    }
    return { insert: vi.fn(), select: vi.fn(), update: vi.fn() };
  });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("dispatchImageBatch — postTextByParentIndex", () => {
  it("writes the correct caption to each job's post_text column", async () => {
    await dispatchImageBatch({
      companyId: COMPANY_UUID,
      triggeredBy: "user-1",
      jobs: [
        { ...BASE_SPEC, parentPostIndex: 0 },
        { ...BASE_SPEC, aspectRatio: "4x5", parentPostIndex: 0 }, // same row, different ratio
        { ...BASE_SPEC, parentPostIndex: 1 },
      ],
      mode: "generate",
      postTextByParentIndex: {
        0: "Caption for row zero.",
        1: "Caption for row one.",
      },
    });

    expect(insertedJobs).toHaveLength(3);
    // Both aspect-ratio variants of row 0 share the same caption.
    expect(insertedJobs[0]?.post_text).toBe("Caption for row zero.");
    expect(insertedJobs[1]?.post_text).toBe("Caption for row zero.");
    // Row 1 gets its own caption.
    expect(insertedJobs[2]?.post_text).toBe("Caption for row one.");
  });

  it("writes post_text=null for jobs with no entry in the caption map", async () => {
    await dispatchImageBatch({
      companyId: COMPANY_UUID,
      triggeredBy: "user-1",
      jobs: [
        { ...BASE_SPEC, parentPostIndex: 0 },
        { ...BASE_SPEC, parentPostIndex: 1 }, // no entry for row 1
      ],
      mode: "generate",
      postTextByParentIndex: { 0: "Only row zero has a caption." },
    });

    expect(insertedJobs[0]?.post_text).toBe("Only row zero has a caption.");
    expect(insertedJobs[1]?.post_text).toBeNull();
  });

  it("writes post_text=null for all jobs when postTextByParentIndex is absent", async () => {
    // Simulates template mode, mood board, or direct batch dispatch — callers
    // that don't pass captions. Zero regression: existing behaviour unchanged.
    await dispatchImageBatch({
      companyId: COMPANY_UUID,
      triggeredBy: "user-1",
      jobs: [
        { ...BASE_SPEC, parentPostIndex: 0 },
        { ...BASE_SPEC, parentPostIndex: 1 },
      ],
      mode: "generate",
      // postTextByParentIndex deliberately omitted
    });

    expect(insertedJobs[0]?.post_text).toBeNull();
    expect(insertedJobs[1]?.post_text).toBeNull();
  });

  it("handles jobs with parentPostIndex=null gracefully — post_text=null", async () => {
    await dispatchImageBatch({
      companyId: COMPANY_UUID,
      triggeredBy: "user-1",
      jobs: [
        // parentPostIndex omitted → undefined → null in the insert
        { ...BASE_SPEC },
      ],
      mode: "generate",
      postTextByParentIndex: { 0: "This caption has no matching job." },
    });

    expect(insertedJobs[0]?.post_text).toBeNull();
  });
});
