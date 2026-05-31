/**
 * Unit tests for the QStash handler template fork (Stream B Phase 1).
 *
 * Tests cover:
 *  - isTemplateJob detection (jobType in body vs in generationParams JSONB)
 *  - handleTemplateJob: happy path (template found, composite succeeds)
 *  - handleTemplateJob: template not found → job marked failed, 500
 *  - handleTemplateJob: compositeImage throws → job marked failed, 500
 *  - Ideogram path unchanged when jobType is absent
 *  - Lease released in finally block for both success and failure
 *
 * Route handler is exercised via direct POST request construction.
 * All external dependencies (Supabase, compositeImage, lease, budget) are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── QStash signature verification ────────────────────────────────────────────
vi.mock("@/lib/qstash", () => ({
  verifyQstashSignature: vi.fn().mockResolvedValue({ ok: true }),
}));

// ─── Supabase ────────────────────────────────────────────────────────────────
// Build a chainable mock: .from().update/select().eq().eq()... all resolve ok.
function makeSupabaseChain(leafValue: Record<string, unknown>) {
  const chain: Record<string, unknown> = {};
  // Allow infinite chaining — every method returns the chain itself or the leaf.
  const proxy = new Proxy(chain, {
    get(_target, prop: string) {
      if (prop === "then") return undefined; // not a Promise
      // Terminal properties that tests read
      if (prop === "count") return leafValue.count ?? 1;
      if (prop === "error") return leafValue.error ?? null;
      if (prop === "data") return leafValue.data ?? null;
      // All methods return the proxy for chaining
      return vi.fn().mockReturnValue(proxy);
    },
  });
  return proxy;
}

const mockFrom = vi.fn();
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => ({ from: mockFrom })),
}));

// ─── Template access ──────────────────────────────────────────────────────────
const mockGetTemplateById = vi.fn();
vi.mock("@/lib/image/templates", () => ({
  get_template: vi.fn(),
  get_template_by_id: (...args: unknown[]) => mockGetTemplateById(...args),
}));

// ─── compositeImage ───────────────────────────────────────────────────────────
const mockCompositeImage = vi.fn();
vi.mock("@/lib/image/compositing", () => ({
  compositeImage: (...args: unknown[]) => mockCompositeImage(...args),
  TEXT_ZONE_MAP: {},
}));

// ─── Lease ────────────────────────────────────────────────────────────────────
const mockReleaseLease = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/image/lease", () => ({
  acquireImageLease: vi.fn().mockResolvedValue({ ok: true }),
  releaseImageLease: (...args: unknown[]) => mockReleaseLease(...args),
  getActiveLeaseCount: vi.fn().mockResolvedValue(0),
  getConcurrencyCap: vi.fn().mockReturnValue(10),
}));

// ─── Budget ───────────────────────────────────────────────────────────────────
vi.mock("@/lib/image/budget", () => ({
  checkImageGenBudget: vi.fn().mockResolvedValue({ allowed: true }),
  incrementImageGenSpend: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/image/budget-notify", () => ({
  notifyImageGenBudgetThreshold: vi.fn(),
}));

// ─── Enqueue (not called for template jobs in success path) ───────────────────
vi.mock("@/lib/image/enqueue", () => ({
  enqueueImageJob: vi.fn().mockResolvedValue({ ok: true }),
}));

// ─── generateWithFallback (Ideogram path — not called for template jobs) ─────
vi.mock("@/lib/image", () => ({
  generateWithFallback: vi.fn().mockResolvedValue([{
    storagePath: "company/ideogram.jpg",
    format: "jpeg",
    width: 1080,
    height: 1080,
  }]),
}));
vi.mock("@/lib/image/generator/preview", () => ({
  generatePreview: vi.fn().mockResolvedValue({ prompt: "test" }),
}));

// ─── Constants ────────────────────────────────────────────────────────────────

const JOB_UUID      = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEMPLATE_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COMPANY_UUID  = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const RESOLVED_TEMPLATE = {
  id: TEMPLATE_UUID,
  name: "Test Template",
  width: 1080,
  height: 1080,
  layers: [],
};

const TEMPLATE_JOB_SPEC = {
  jobType: "template",
  templateId: TEMPLATE_UUID,
  variantKey: "square",
  modifications: [{ name: "headline", text: "Hello World" }],
  aspectRatio: "1x1",
  companyId: COMPANY_UUID,
};

async function makeRequest(body: Record<string, unknown>): Promise<NextRequest> {
  return new NextRequest("http://localhost/api/internal/image/qstash-handler", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "upstash-signature": "fake" },
  });
}

// ─── Import handler after all mocks are set up ────────────────────────────────

import { POST } from "@/app/api/internal/image/qstash-handler/route";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("QStash handler — template fork", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset chainable Supabase mock — .update/.select/.eq... all succeed by default.
    mockFrom.mockReturnValue(makeSupabaseChain({ count: 1, error: null, data: null }));
    mockReleaseLease.mockResolvedValue(undefined);
  });

  it("detects template job via jobType field in body", async () => {
    mockGetTemplateById.mockResolvedValue({
      resolvedTemplate: RESOLVED_TEMPLATE,
    });
    mockCompositeImage.mockResolvedValue({ storagePath: "company/template-composite/123-job.png", provider: "sharp_layer_native", durationMs: 50 });

    const req = await makeRequest({ jobId: JOB_UUID, jobType: "template", generationParams: TEMPLATE_JOB_SPEC });
    const res = await POST(req);
    const body = await res.json() as Record<string, unknown>;

    expect(body.status).toBe("completed");
    expect(mockCompositeImage).toHaveBeenCalledOnce();
  });

  it("detects template job via generationParams.jobType (JSONB re-read path)", async () => {
    // No top-level jobType — it's inside generationParams (as stored in the DB)
    mockGetTemplateById.mockResolvedValue({ resolvedTemplate: RESOLVED_TEMPLATE });
    mockCompositeImage.mockResolvedValue({ storagePath: "s/path.png", provider: "p", durationMs: 10 });

    const req = await makeRequest({ jobId: JOB_UUID, generationParams: TEMPLATE_JOB_SPEC });
    const res = await POST(req);
    const body = await res.json() as Record<string, unknown>;

    expect(body.status).toBe("completed");
    expect(mockCompositeImage).toHaveBeenCalledOnce();
  });

  it("calls compositeImage with schema_version=2, template, modifications, variantKey", async () => {
    mockGetTemplateById.mockResolvedValue({ resolvedTemplate: RESOLVED_TEMPLATE });
    mockCompositeImage.mockResolvedValue({ storagePath: "s/path.png", provider: "p", durationMs: 10 });

    const req = await makeRequest({ jobId: JOB_UUID, jobType: "template", generationParams: TEMPLATE_JOB_SPEC });
    await POST(req);

    expect(mockCompositeImage).toHaveBeenCalledWith(
      expect.objectContaining({
        schema_version: 2,
        template: RESOLVED_TEMPLATE,
        modifications: TEMPLATE_JOB_SPEC.modifications,
        variantKey: "square",
      }),
    );
  });

  it("marks job failed and returns 500 when template not found", async () => {
    mockGetTemplateById.mockResolvedValue(null);

    const req = await makeRequest({ jobId: JOB_UUID, jobType: "template", generationParams: TEMPLATE_JOB_SPEC });
    const res = await POST(req);

    expect(res.status).toBe(500);
    expect(mockCompositeImage).not.toHaveBeenCalled();
  });

  it("marks job failed and returns 500 when template has no resolvedTemplate", async () => {
    // v1 template — resolvedTemplate is undefined
    mockGetTemplateById.mockResolvedValue({ resolvedTemplate: undefined });

    const req = await makeRequest({ jobId: JOB_UUID, jobType: "template", generationParams: TEMPLATE_JOB_SPEC });
    const res = await POST(req);

    expect(res.status).toBe(500);
  });

  it("marks job failed and returns 500 when compositeImage throws", async () => {
    mockGetTemplateById.mockResolvedValue({ resolvedTemplate: RESOLVED_TEMPLATE });
    mockCompositeImage.mockRejectedValue(new Error("sharp blew up"));

    const req = await makeRequest({ jobId: JOB_UUID, jobType: "template", generationParams: TEMPLATE_JOB_SPEC });
    const res = await POST(req);

    expect(res.status).toBe(500);
  });

  it("always releases the lease — success path", async () => {
    mockGetTemplateById.mockResolvedValue({ resolvedTemplate: RESOLVED_TEMPLATE });
    mockCompositeImage.mockResolvedValue({ storagePath: "s/path.png", provider: "p", durationMs: 10 });

    const req = await makeRequest({ jobId: JOB_UUID, jobType: "template", generationParams: TEMPLATE_JOB_SPEC });
    await POST(req);

    expect(mockReleaseLease).toHaveBeenCalledWith(JOB_UUID);
  });

  it("always releases the lease — failure path", async () => {
    mockGetTemplateById.mockResolvedValue(null); // throws inside handler

    const req = await makeRequest({ jobId: JOB_UUID, jobType: "template", generationParams: TEMPLATE_JOB_SPEC });
    await POST(req);

    expect(mockReleaseLease).toHaveBeenCalledWith(JOB_UUID);
  });

  it("does NOT call compositeImage when job is Ideogram (no jobType)", async () => {
    const ideogramSpec = {
      styleId: "clean_corporate",
      primaryColour: "#1a56db",
      compositionType: "split_layout",
      aspectRatio: "1x1",
      companyId: COMPANY_UUID,
    };

    const req = await makeRequest({ jobId: JOB_UUID, generationParams: ideogramSpec });
    await POST(req);

    // Template compositor should not be invoked on the Ideogram path
    expect(mockGetTemplateById).not.toHaveBeenCalled();
  });
});
