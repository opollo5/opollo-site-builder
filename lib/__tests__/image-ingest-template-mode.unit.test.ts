/**
 * Unit tests for the ingest route template mode (Stream B Phase 2).
 *
 * Tests cover:
 *  - ingest_mode=template validation (XLSX only, template_id required)
 *  - Template not found → 404
 *  - v1 template (schemaVersion ≠ 2) → 422
 *  - Column mapping: required field unmatched → 422 MAPPING_FAILED
 *  - Happy path: correct TemplateJobSpec fan-out (row × variant count)
 *  - Pre-dispatch summary in response (mappingSummary, estimatedCostCents)
 *  - Ideogram path unaffected when ingest_mode absent
 *
 * parseXlsxRawRows is mocked — its own round-trip tests are in
 * image-xlsx-raw-parse.unit.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── Auth gate ────────────────────────────────────────────────────────────────
const mockGate = vi.fn();
vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: (...args: unknown[]) => mockGate(...args),
}));

// ─── Rate limit ───────────────────────────────────────────────────────────────
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ ok: true }),
  rateLimitExceeded: vi.fn(),
}));

// ─── Raw XLSX parser (mocked; real tests in xlsx-raw-parse.unit.test.ts) ─────
const mockParseXlsxRawRows = vi.fn();
vi.mock("@/lib/ingestion/xlsx-raw-parse", () => ({
  parseXlsxRawRows: (...args: unknown[]) => mockParseXlsxRawRows(...args),
}));

// ─── Template access ──────────────────────────────────────────────────────────
const mockGetTemplateById = vi.fn();
vi.mock("@/lib/image/templates", () => ({
  get_template_by_id: (...args: unknown[]) => mockGetTemplateById(...args),
}));

// ─── dispatchImageBatch ────────────────────────────────────────────────────────
const mockDispatch = vi.fn();
vi.mock("@/lib/image/dispatch", () => ({
  dispatchImageBatch: (...args: unknown[]) => mockDispatch(...args),
}));

// ─── Ideogram path mocks (must not be called in template mode tests) ──────────
vi.mock("@/lib/ingestion/xlsx-parse", () => ({
  parseXlsxBuffer: vi.fn().mockResolvedValue({
    ok: true,
    posts: [{ post_topic: "t", sourceRow: 2 }],
    warnings: [],
  }),
}));
vi.mock("@/lib/ingestion/docx-parse", () => ({
  parseDocxBuffer: vi.fn().mockResolvedValue({ ok: true, posts: [], warnings: [] }),
}));
vi.mock("@/lib/ingestion/interpret", () => ({
  interpretPosts: vi.fn().mockResolvedValue({ ok: true, posts: [] }),
}));
vi.mock("@/lib/image/fan-out", () => ({
  fanOutJobs: vi.fn().mockReturnValue([]),
}));
vi.mock("@/lib/image/budget", () => ({
  PRICE_CENTS_PER_JOB: 6,
}));

// ─── Constants ────────────────────────────────────────────────────────────────

const COMPANY_UUID  = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEMPLATE_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BATCH_UUID    = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const RESOLVED_TEMPLATE = {
  id: TEMPLATE_UUID,
  version: 2,
  name: "Test Template",
  width: 1080, height: 1080,
  orientation: "square",
  background_color: "#ffffff",
  variants: [
    { key: "landscape", width: 1920, height: 1080, overrides: [] },
  ],
  layers: [
    {
      id: "layer-1",
      name: "headline",
      type: "text",
      x: 0, y: 0, width: 400, height: 100,
      opacity: 1, rotation: 0, rotate_x: 0, rotate_y: 0, rotate_z: 0,
      skew_x: 0, skew_y: 0, locked: false, hide: false, hide_when_empty: false,
      lock_aspect_ratio: false, description: "", group: null,
      constraints: { horizontal: "left", vertical: "top" },
      text: "Default", font_family: "Inter", font_size: 32, font_weight: 400,
      color: "#000", text_align_h: "left", text_align_v: "top",
      letter_spacing: 0, line_height: 1.2, text_transform: "none",
      text_decoration: "none", word_break: "normal", style: "", direction: "ltr",
      text_fit: { enabled: false, min_size: 16, max_size: 120, max_lines: 4 },
      truncate: false, text_box: { padding: null, border: null },
      background: { color: null, border: null, border_width: null, padding_h: 0, padding_v: 0, shadow: null, radius: null, shift: null },
      secondary: { font_family: null, color: null },
      var: { label: "Headline Text", required: true, default: "", category: "content", help: "" },
    },
  ],
  groups: [], fonts: [],
  render_settings: { format: "png", quality: 90, scale: 1, dpi: 72 },
  settings: { guides: false },
};

const V2_TEMPLATE = { schemaVersion: 2, resolvedTemplate: RESOLVED_TEMPLATE };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeXlsxFile(): File {
  const blob = new Blob([Buffer.from("xlsx")], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  return new File([blob], "test.xlsx", { type: blob.type });
}

function makeDocxFile(): File {
  const blob = new Blob([Buffer.from("docx")], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  return new File([blob], "test.docx", { type: blob.type });
}

function makeRequest(file: File, extraFields: Record<string, string> = {}): NextRequest {
  const fd = new FormData();
  fd.append("company_id", COMPANY_UUID);
  for (const [k, v] of Object.entries(extraFields)) fd.append(k, v);
  fd.append("file", file);
  return new NextRequest("http://localhost/api/platform/image/ingest", { method: "POST", body: fd });
}

// ─── Import handler after mocks ───────────────────────────────────────────────

import { POST } from "@/app/api/platform/image/ingest/route";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ingest route — template mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGate.mockResolvedValue({ kind: "allow", userId: "user-123" });
    mockDispatch.mockResolvedValue({ ok: true, batchId: BATCH_UUID, totalJobs: 2, mode: "generate" });
    mockParseXlsxRawRows.mockResolvedValue({
      ok: true,
      headers: ["headline"],
      rows: [{ headline: "Hello World" }],
      rowCount: 1,
    });
  });

  it("requires template_id when ingest_mode=template", async () => {
    const req = makeRequest(makeXlsxFile(), { ingest_mode: "template" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects DOCX for ingest_mode=template", async () => {
    const req = makeRequest(makeDocxFile(), { ingest_mode: "template", template_id: TEMPLATE_UUID });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 when template not found", async () => {
    mockGetTemplateById.mockResolvedValue(null);
    const req = makeRequest(makeXlsxFile(), { ingest_mode: "template", template_id: TEMPLATE_UUID });
    const res = await POST(req);
    const body = await res.json() as { error: Record<string, unknown> };

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("TEMPLATE_NOT_FOUND");
  });

  it("returns 422 when template is schema_version=1", async () => {
    mockGetTemplateById.mockResolvedValue({ schemaVersion: 1, resolvedTemplate: undefined });
    const req = makeRequest(makeXlsxFile(), { ingest_mode: "template", template_id: TEMPLATE_UUID });
    const res = await POST(req);
    const body = await res.json() as { error: Record<string, unknown> };

    expect(res.status).toBe(422);
    expect(body.error.code).toBe("TEMPLATE_NOT_V2");
  });

  it("returns 422 MAPPING_FAILED when required field has no column", async () => {
    mockGetTemplateById.mockResolvedValue(V2_TEMPLATE);
    // Spreadsheet has no "headline" column — required field unmatched
    mockParseXlsxRawRows.mockResolvedValue({
      ok: true,
      headers: ["unrelated_col"],
      rows: [{ unrelated_col: "value" }],
      rowCount: 1,
    });

    const req = makeRequest(makeXlsxFile(), { ingest_mode: "template", template_id: TEMPLATE_UUID });
    const res = await POST(req);
    const body = await res.json() as { error: Record<string, unknown> };

    expect(res.status).toBe(422);
    expect(body.error.code).toBe("MAPPING_FAILED");
    expect((body.error.unmatchedRequired as string[]).includes("headline")).toBe(true);
  });

  it("happy path: returns 201 with batchId, mappingSummary, estimatedCostCents", async () => {
    mockGetTemplateById.mockResolvedValue(V2_TEMPLATE);
    mockParseXlsxRawRows.mockResolvedValue({
      ok: true,
      headers: ["headline"],
      rows: [{ headline: "Row 1" }, { headline: "Row 2" }],
      rowCount: 2,
    });
    // 2 rows × 2 variants (base + landscape) = 4 jobs
    mockDispatch.mockResolvedValue({ ok: true, batchId: BATCH_UUID, totalJobs: 4, mode: "generate" });

    const req = makeRequest(makeXlsxFile(), { ingest_mode: "template", template_id: TEMPLATE_UUID });
    const res = await POST(req);
    const body = await res.json() as { ok: boolean; data: Record<string, unknown> };

    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.batchId).toBe(BATCH_UUID);
    expect(body.data.rowCount).toBe(2);
    expect(body.data.variantCount).toBe(2); // base + landscape
    expect(body.data.totalJobs).toBe(4);
    expect(body.data.estimatedCostCents).toBe(24); // 4 × 6¢
    expect(body.data.mappingSummary).toMatchObject({ matchedFields: 1, unmatchedOptional: 0 });
  });

  it("dispatches TemplateJobSpec with correct jobType and templateId", async () => {
    mockGetTemplateById.mockResolvedValue(V2_TEMPLATE);

    const req = makeRequest(makeXlsxFile(), { ingest_mode: "template", template_id: TEMPLATE_UUID });
    await POST(req);

    const dispatchArg = mockDispatch.mock.calls[0][0] as { jobs: Array<Record<string, unknown>> };
    expect(dispatchArg.jobs.every((j) => j.jobType === "template")).toBe(true);
    expect(dispatchArg.jobs.every((j) => j.templateId === TEMPLATE_UUID)).toBe(true);
    // Base (variantKey=undefined) + landscape variant
    const variantKeys = dispatchArg.jobs.map((j) => j.variantKey);
    expect(variantKeys).toContain(undefined);
    expect(variantKeys).toContain("landscape");
  });

  it("injects companyId into dispatch jobs so QStash handler can read it", async () => {
    mockGetTemplateById.mockResolvedValue(V2_TEMPLATE);

    const req = makeRequest(makeXlsxFile(), { ingest_mode: "template", template_id: TEMPLATE_UUID });
    await POST(req);

    // dispatch.ts injects companyId into the JSONB via { ...spec, companyId }
    // We verify dispatch was called with the correct company
    const dispatchArg = mockDispatch.mock.calls[0][0] as { companyId: string };
    expect(dispatchArg.companyId).toBe(COMPANY_UUID);
  });

  it("ideogram path is unaffected when ingest_mode is absent", async () => {
    const req = makeRequest(makeXlsxFile());
    await POST(req);
    // Template accessor not called on Ideogram path
    expect(mockGetTemplateById).not.toHaveBeenCalled();
  });
});
