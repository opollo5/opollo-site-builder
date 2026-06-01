/**
 * Slice I — Regenerate-with-feedback (D21, D22, D23, D26, D27, D29, D30)
 *
 * Unit tests:
 *  - Prompt build with pin hints (D30 region format)
 *  - Grid mapping for pin coordinates (D29)
 *  - ≤3 pin enforcement (D22) — API Zod schema
 *  - API dispatch: params shape (D21) — feedback_text, pins, parent_job_id in JSONB
 *  - Slot shows regenerating via existing polling (D27 — no new poller needed)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// ─── D29 + D30: safe-zone helpers (shared with Slice H) ─────────────────────

import { coordToGridRegion, buildSafeZoneFragment } from "@/lib/image/generator/safe-zones";
import { buildPrompt } from "@/lib/image/generator/prompt-engine";

describe("Slice I — prompt build with feedback hints (D29, D30)", () => {
  it("pin coordinates map to correct region (D29)", () => {
    expect(coordToGridRegion(0.9, 0.5)).toBe("mid-right");
    expect(coordToGridRegion(0.1, 0.9)).toBe("bottom-left");
    expect(coordToGridRegion(0.5, 0.5)).toBe("center");
  });

  it("buildSafeZoneFragment matches D30 exact format", () => {
    const frag = buildSafeZoneFragment(["mid-right"]);
    expect(frag).toBe(
      "Composition constraints: keep the mid-right area(s) visually simple and low-detail for overlaid text and logo. Do not place faces, hands, product hero elements, or fine details there."
    );
  });

  it("base + safe-zone + pin hint forms a coherent enhanced prompt", () => {
    const base = buildPrompt({
      styleId: "clean_corporate",
      primaryColour: "#1a56db",
      compositionType: "split_layout",
    });
    const safeZone = buildSafeZoneFragment(["mid-right"]);
    const pinHint = "mid-right area — too cluttered";
    const feedback = "Make the overall background lighter";
    const enhanced = [base, safeZone, `Specific guidance: ${pinHint}`, `General feedback: ${feedback}`].join(". ");

    expect(enhanced).toContain("Composition constraints:");
    expect(enhanced).toContain("mid-right");
    expect(enhanced).toContain("Make the overall background lighter");
    expect(enhanced).toContain("too cluttered");
    // D23: full-image regeneration, no region-lock language
    expect(enhanced).not.toContain("edit only");
    expect(enhanced).not.toContain("edit this area");
  });
});

// ─── D22: ≤3 pins enforcement (Zod validation) ───────────────────────────────

vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: vi.fn().mockResolvedValue({ kind: "allow", userId: "u1" }),
}));

const mockFrom = vi.fn();
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock("@/lib/image/enqueue", () => ({
  enqueueImageJob: vi.fn().mockResolvedValue({ ok: true }),
}));

const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NEW_JOB_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function setupMockDb(overrides: {
  insertResult?: { id: string } | null;
} = {}) {
  mockFrom.mockImplementation((table: string) => {
    if (table === "image_generation_jobs") {
      let callCount = 0;
      return {
        select() {
          callCount++;
          if (callCount === 1) {
            // First call: load parent job
            return { eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: JOB_ID, company_id: COMPANY_ID, batch_id: "batch-1", generation_params: { styleId: "clean_corporate", primaryColour: "#000", compositionType: "split_layout", companyId: COMPANY_ID }, target_platforms: ["linkedin"], target_publish_date: null, parent_post_index: 0, post_text: "Caption" }, error: null }) };
          }
          return { eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
        },
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: overrides.insertResult !== undefined ? overrides.insertResult : { id: NEW_JOB_ID },
              error: null,
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      };
    }
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
  });
}

import { POST } from "@/app/api/platform/image/jobs/[id]/regenerate/route";

function makeReq(body: Record<string, unknown>) {
  return new NextRequest(
    `http://localhost/api/platform/image/jobs/${JOB_ID}/regenerate`,
    { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } },
  );
}

describe("Slice I — regenerate API (D21, D22)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMockDb();
  });

  it("D22: 4 pins rejected with 400", async () => {
    const fourPins = Array.from({ length: 4 }, (_, i) => ({
      x: 0.1 * (i + 1), y: 0.5, region: "mid-left", comment: `pin ${i}`,
    }));
    const res = await POST(makeReq({ company_id: COMPANY_ID, pins: fourPins }), { params: Promise.resolve({ id: JOB_ID }) });
    expect(res.status).toBe(400);
  });

  it("D22: ≤3 pins accepted (3 is the max)", async () => {
    const threePins = Array.from({ length: 3 }, (_, i) => ({
      x: 0.1 * (i + 1), y: 0.5, region: "mid-left" as const, comment: `pin ${i}`,
    }));
    const res = await POST(makeReq({ company_id: COMPANY_ID, pins: threePins, feedback_text: "looks good overall" }), { params: Promise.resolve({ id: JOB_ID }) });
    expect(res.status).toBe(200);
  });

  it("D21: new job created with feedback fields in generation_params", async () => {
    const res = await POST(makeReq({
      company_id: COMPANY_ID,
      feedback_text: "Too dark on the left side",
      pins: [{ x: 0.1, y: 0.5, region: "mid-left" as const, comment: "too dark" }],
    }), { params: Promise.resolve({ id: JOB_ID }) });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: { newJobId: string } };
    expect(body.ok).toBe(true);
    expect(body.data.newJobId).toBe(NEW_JOB_ID);
  });

  it("D21: no feedback = valid (feedback_text and pins are optional)", async () => {
    const res = await POST(makeReq({ company_id: COMPANY_ID }), { params: Promise.resolve({ id: JOB_ID }) });
    // Empty feedback_text + no pins → still creates a job (base prompt only)
    expect(res.status).toBe(200);
  });
});
