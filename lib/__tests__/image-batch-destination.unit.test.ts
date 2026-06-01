/**
 * Slice D — Generate destination fork (D4, D5)
 *
 * Tests:
 *  - destination='publish' (default) written to batch row
 *  - destination='download' written to batch row
 *  - dispatch with no destination defaults to 'publish'
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const capturedBatchInserts: Array<Record<string, unknown>> = [];

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === "platform_companies") {
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { monthly_image_gen_budget_cents: 1_000_000 }, error: null }) };
      }
      if (table === "image_gen_spend") {
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
      }
      if (table === "image_generation_batches") {
        return {
          insert: vi.fn((row: Record<string, unknown>) => {
            capturedBatchInserts.push(row);
            return { select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { id: "batch-1" }, error: null }) };
          }),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      if (table === "image_generation_jobs") {
        return { insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }) }) }), update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) };
      }
      return { insert: vi.fn(), select: vi.fn(), update: vi.fn(), eq: vi.fn() };
    }),
  })),
}));

vi.mock("@/lib/image/enqueue", () => ({ enqueueImageJob: vi.fn().mockResolvedValue({ ok: true }) }));

import { dispatchImageBatch } from "@/lib/image/dispatch";

const BASE_JOB = { styleId: "clean_corporate" as const, primaryColour: "#123456", compositionType: "split_layout" as const, aspectRatio: "1x1" as const };
const COMPANY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

beforeEach(() => {
  capturedBatchInserts.length = 0;
  vi.clearAllMocks();
});

describe("dispatchImageBatch — destination (D5)", () => {
  it("persists destination='publish' on the batch row", async () => {
    await dispatchImageBatch({ companyId: COMPANY, triggeredBy: "u1", jobs: [BASE_JOB], mode: "generate", destination: "publish" });
    expect(capturedBatchInserts[0]?.destination).toBe("publish");
  });

  it("persists destination='download' on the batch row", async () => {
    await dispatchImageBatch({ companyId: COMPANY, triggeredBy: "u1", jobs: [BASE_JOB], mode: "generate", destination: "download" });
    expect(capturedBatchInserts[0]?.destination).toBe("download");
  });

  it("defaults to 'publish' when destination is omitted", async () => {
    await dispatchImageBatch({ companyId: COMPANY, triggeredBy: "u1", jobs: [BASE_JOB], mode: "generate" });
    expect(capturedBatchInserts[0]?.destination).toBe("publish");
  });
});
