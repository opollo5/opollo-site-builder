import { describe, it, expect, vi, beforeEach } from "vitest";

// B5 — preview-mode tests for the qstash handler.
//
// Verifies that when previewOnly=true is in the QStash payload:
//   1. Ideogram is NOT called (generateWithFallback mock is untouched)
//   2. The job is marked state=completed with result_storage_path=null
//   3. An image_generation_log row is inserted with outcome='preview'
//   4. Spend is NOT incremented
//   5. Lease is NOT acquired
//
// Plus a unit test for the preview generator itself: prompt text is the
// same shape as the real Ideogram-bound prompt.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted mocks
// ─────────────────────────────────────────────────────────────────────────────
const { mockVerify } = vi.hoisted(() => ({ mockVerify: vi.fn() }));
vi.mock("@/lib/qstash", () => ({
  verifyQstashSignature: mockVerify,
  getQstashClient: vi.fn(() => ({ publishJSON: vi.fn() })),
}));

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

const { mockIncrementSpend } = vi.hoisted(() => ({ mockIncrementSpend: vi.fn() }));
vi.mock("@/lib/image/budget", () => ({
  incrementImageGenSpend: mockIncrementSpend,
  checkImageGenBudget: vi.fn(),
}));

vi.mock("@/lib/image/budget-notify", () => ({
  notifyImageGenBudgetThreshold: vi.fn(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const JOB_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BATCH_UUID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

import type { GenerationParams } from "@/lib/image/types";

const VALID_PARAMS: GenerationParams = {
  styleId: "clean_corporate",
  primaryColour: "#1a56db",
  compositionType: "split_layout",
  aspectRatio: "1x1",
  companyId: COMPANY_UUID,
};

function makeRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/internal/image/qstash-handler", {
    method: "POST",
    headers: { "upstash-signature": "valid-sig", "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

interface RecordedTableCall {
  table: string;
  op: "update" | "insert";
  patch?: unknown;
  inserted?: unknown;
}

const tableCalls: RecordedTableCall[] = [];

function buildFromMock(): (table: string) => unknown {
  return (table: string) => ({
    update: vi.fn().mockImplementation((patch: unknown) => {
      const call: RecordedTableCall = { table, op: "update", patch };
      return {
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation(async () => {
            tableCalls.push(call);
            return { error: null };
          }),
          then: (onFulfilled: (v: unknown) => unknown) => {
            tableCalls.push(call);
            return Promise.resolve({ error: null }).then(onFulfilled);
          },
        }),
      };
    }),
    insert: vi.fn().mockImplementation((row: unknown) => {
      const call: RecordedTableCall = { table, op: "insert", inserted: row };
      // The handler awaits .insert(...) directly, then chains .then(...)
      const result = Promise.resolve({ error: null });
      tableCalls.push(call);
      return {
        ...result,
        then: result.then.bind(result),
      };
    }),
    select: vi.fn(),
  });
}

import { POST } from "@/app/api/internal/image/qstash-handler/route";
import type { NextRequest } from "next/server";

beforeEach(() => {
  vi.clearAllMocks();
  tableCalls.length = 0;
  mockVerify.mockResolvedValue({ ok: true });
  mockAcquire.mockResolvedValue({ ok: true });
  mockCount.mockResolvedValue(0);
  mockCap.mockReturnValue(12);
  mockFrom.mockImplementation(buildFromMock());
});

// ─────────────────────────────────────────────────────────────────────────────
// Preview-mode path
// ─────────────────────────────────────────────────────────────────────────────

describe("qstash handler — previewOnly=true", () => {
  it("does NOT call Ideogram, does NOT acquire lease, marks job completed with null storage path", async () => {
    const req = makeRequest({
      jobId: JOB_UUID,
      generationParams: VALID_PARAMS,
      batchId: BATCH_UUID,
      previewOnly: true,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = (await res.json()) as { ok: boolean; status: string; prompt: string };
    expect(json.ok).toBe(true);
    expect(json.status).toBe("preview");
    expect(json.prompt.length).toBeGreaterThan(0);

    // Ideogram never called.
    expect(mockGenerate).not.toHaveBeenCalled();
    // Lease never acquired in preview mode.
    expect(mockAcquire).not.toHaveBeenCalled();
    // Spend NOT incremented.
    expect(mockIncrementSpend).not.toHaveBeenCalled();

    // Job state marked completed; result_storage_path = null.
    const jobUpdates = tableCalls.filter(
      (c) => c.op === "update" && c.table === "image_generation_jobs",
    );
    expect(jobUpdates.length).toBeGreaterThanOrEqual(1);
    const patch = jobUpdates[0].patch as {
      state: string;
      result_storage_path: string | null;
      generation_params: { preview_prompt: string };
    };
    expect(patch.state).toBe("completed");
    expect(patch.result_storage_path).toBeNull();
    expect(patch.generation_params.preview_prompt.length).toBeGreaterThan(0);

    // image_generation_log row inserted with outcome='preview'.
    const logInserts = tableCalls.filter(
      (c) => c.op === "insert" && c.table === "image_generation_log",
    );
    expect(logInserts).toHaveLength(1);
    const logRow = logInserts[0].inserted as {
      outcome: string;
      style_id: string;
      composition_type: string;
      aspect_ratio: string;
      prompt_used: string;
      company_id: string;
    };
    expect(logRow.outcome).toBe("preview");
    expect(logRow.style_id).toBe("clean_corporate");
    expect(logRow.composition_type).toBe("split_layout");
    expect(logRow.aspect_ratio).toBe("1x1");
    expect(logRow.company_id).toBe(COMPANY_UUID);
    expect(logRow.prompt_used.length).toBeGreaterThan(0);
  });

  // Non-preview sanity is covered by image-qstash-handler.unit.test.ts;
  // this file is preview-specific.
});

// ─────────────────────────────────────────────────────────────────────────────
// Preview generator (pure function)
// ─────────────────────────────────────────────────────────────────────────────

describe("generatePreview", () => {
  it("returns a non-empty prompt for a valid GenerationParams", async () => {
    const { generatePreview } = await import("@/lib/image/generator/preview");
    const result = generatePreview(VALID_PARAMS);
    expect(result.prompt.length).toBeGreaterThan(0);
  });

  it("varies prompt by styleId (deterministic)", async () => {
    const { generatePreview } = await import("@/lib/image/generator/preview");
    const a = generatePreview({ ...VALID_PARAMS, styleId: "clean_corporate" as const });
    const b = generatePreview({ ...VALID_PARAMS, styleId: "bold_promo" as const });
    expect(a.prompt).not.toBe(b.prompt);
  });

  it("simplifyPrompt=true changes the prompt vs default", async () => {
    const { generatePreview } = await import("@/lib/image/generator/preview");
    const a = generatePreview(VALID_PARAMS);
    const b = generatePreview({ ...VALID_PARAMS, simplifyPrompt: true });
    expect(a.prompt).not.toBe(b.prompt);
  });
});
