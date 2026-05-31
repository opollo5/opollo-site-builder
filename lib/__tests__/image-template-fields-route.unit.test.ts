/**
 * Unit tests for GET /api/platform/image/templates/:id/fields (Task 1).
 *
 * Contract tests covering:
 *  - Returns TemplateField[] only for layers with var.label set
 *  - Filters out layers without var metadata
 *  - Returns [] for schema_version=1 (fixed-zone) templates
 *  - Returns 404 when template not found
 *  - Returns 400 when company_id missing/invalid
 *  - Auth gate fires on deny
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── Auth gate mock ───────────────────────────────────────────────────────────
const { mockGate, mockMaybeSingle } = vi.hoisted(() => ({
  mockGate: vi.fn(),
  mockMaybeSingle: vi.fn(),
}));

vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: mockGate,
}));

// ─── Supabase mock ───────────────────────────────────────────────────────────
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => ({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      maybeSingle: mockMaybeSingle,
    }),
  }),
}));

import type { NextRequest } from "next/server";
import { GET } from "@/app/api/platform/image/templates/[id]/fields/route";
import { TEMPLATE_SCHEMA_VERSION, LEGACY_SCHEMA_VERSION } from "@/lib/image/template-model";
import type { Template } from "@/lib/image/template-model";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ALLOW_GATE = { kind: "allow" as const, userId: "user_001", companyId: "co_001" };
const DENY_GATE = {
  kind: "deny" as const,
  response: new Response(JSON.stringify({ ok: false }), { status: 403 }),
};

function makeRequest(id = "tmpl_001", companyId = "123e4567-e89b-12d3-a456-426614174000") {
  return new Request(`https://app.opollo.com/api/platform/image/templates/${id}/fields?company_id=${companyId}`);
}

const V2_TEMPLATE: Template = {
  id: "tmpl_001",
  version: 2,
  name: "Test",
  width: 1080, height: 1080,
  orientation: "square",
  background_color: "#000",
  layers: [
    {
      id: "l1", name: "headline", type: "text",
      x: 0, y: 0, width: 500, height: 100,
      rotation: 0, rotate_x: 0, rotate_y: 0, rotate_z: 0,
      skew_x: 0, skew_y: 0, opacity: 1,
      locked: false, hide: false, hide_when_empty: false,
      lock_aspect_ratio: false, description: "", group: null,
      constraints: { horizontal: "left", vertical: "top" },
      text: "Default headline",
      font_family: "Inter", font_size: 48, font_weight: 700,
      color: "#fff", text_align_h: "left", text_align_v: "center",
      letter_spacing: 0, line_height: 1.2,
      text_transform: "none", text_decoration: "none",
      word_break: "normal", style: "", direction: "ltr",
      text_fit: { enabled: false, min_size: 16, max_size: 120, max_lines: 4 },
      truncate: false,
      text_box: { padding: null, border: null },
      background: { color: null, border: null, border_width: null, padding_h: 0, padding_v: 0, shadow: null, radius: null, shift: null },
      secondary: { font_family: null, color: null },
      // Has var — should appear in /fields
      var: { label: "Headline Text", required: true, default: "", category: "content", help: "Main caption" },
    },
    {
      id: "l2", name: "background", type: "image",
      x: 0, y: 0, width: 1080, height: 1080,
      rotation: 0, rotate_x: 0, rotate_y: 0, rotate_z: 0,
      skew_x: 0, skew_y: 0, opacity: 1,
      locked: true, hide: false, hide_when_empty: true,
      lock_aspect_ratio: false, description: "", group: null,
      constraints: { horizontal: "left_right", vertical: "top_bottom" },
      asset_id: null, image_url: null,
      fill: "cover", anchor_x: "center", anchor_y: "center",
      tint_color: null, border_radius: 0, clip_path: null, face_detect: false,
      // Has var — should appear in /fields
      var: { label: "Background Image", required: false, default: "", category: "media", help: "" },
    },
    {
      id: "l3", name: "overlay", type: "rectangle",
      x: 0, y: 800, width: 1080, height: 280,
      rotation: 0, rotate_x: 0, rotate_y: 0, rotate_z: 0,
      skew_x: 0, skew_y: 0, opacity: 0.8,
      locked: true, hide: false, hide_when_empty: false,
      lock_aspect_ratio: false, description: "", group: null,
      constraints: { horizontal: "left_right", vertical: "bottom" },
      color: "#000", gradient: null, border_radius: 0, border: null,
      // NO var — should NOT appear in /fields (design element, not an API field)
    },
  ],
  groups: [], fonts: [], variants: [],
  render_settings: { format: "png", quality: 100, scale: 1, dpi: 72 },
  settings: { guides: true },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/platform/image/templates/:id/fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGate.mockResolvedValue(ALLOW_GATE);
  });

  it("returns TemplateField[] only for layers with var.label set", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { id: "tmpl_001", schema_version: TEMPLATE_SCHEMA_VERSION, definition: V2_TEMPLATE },
      error: null,
    });
    const res = await GET(makeRequest() as unknown as NextRequest, { params: Promise.resolve({ id: "tmpl_001" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.fields).toHaveLength(2); // headline + background (overlay has no var)
    expect(body.fields[0]).toEqual({
      name: "headline",
      type: "text",
      var: { label: "Headline Text", required: true, default: "", category: "content", help: "Main caption" },
    });
    expect(body.fields[1]).toEqual({
      name: "background",
      type: "image",
      var: { label: "Background Image", required: false, default: "", category: "media", help: "" },
    });
  });

  it("excludes layers whose var.label is empty string", async () => {
    const withEmptyLabel = {
      ...V2_TEMPLATE,
      layers: [{ ...V2_TEMPLATE.layers[0], var: { label: "", required: false, default: "", category: "content" as const, help: "" } }],
    };
    mockMaybeSingle.mockResolvedValue({
      data: { id: "t1", schema_version: TEMPLATE_SCHEMA_VERSION, definition: withEmptyLabel },
      error: null,
    });
    const res = await GET(makeRequest() as unknown as NextRequest, { params: Promise.resolve({ id: "t1" }) });
    const body = await res.json();
    expect(body.fields).toHaveLength(0);
  });

  it("returns [] for schema_version=1 (v1 fixed-zone) templates", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: "t_v1", schema_version: LEGACY_SCHEMA_VERSION,
        definition: { compositionType: "split_layout", overlayAlpha: 0.75 },
      },
      error: null,
    });
    const res = await GET(makeRequest() as unknown as NextRequest, { params: Promise.resolve({ id: "t_v1" }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.fields).toEqual([]);
  });

  it("returns 404 when template not found", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await GET(makeRequest() as unknown as NextRequest, { params: Promise.resolve({ id: "tmpl_nope" }) });
    expect(res.status).toBe(404);
  });

  it("returns 400 when company_id is missing", async () => {
    const req = new Request("https://app.opollo.com/api/platform/image/templates/t1/fields");
    const res = await GET(req as unknown as NextRequest, { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 when company_id is not a valid UUID", async () => {
    const req = new Request("https://app.opollo.com/api/platform/image/templates/t1/fields?company_id=not-a-uuid");
    const res = await GET(req as unknown as NextRequest, { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(400);
  });

  it("returns 403 when auth gate denies", async () => {
    mockGate.mockResolvedValue(DENY_GATE);
    const res = await GET(makeRequest() as unknown as NextRequest, { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(403);
  });

  it("returns 500 on DB error", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: "connection refused" } });
    const res = await GET(makeRequest() as unknown as NextRequest, { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(500);
  });

  it("field order matches layer array order in the template", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { id: "t1", schema_version: TEMPLATE_SCHEMA_VERSION, definition: V2_TEMPLATE },
      error: null,
    });
    const res = await GET(makeRequest() as unknown as NextRequest, { params: Promise.resolve({ id: "t1" }) });
    const body = await res.json();
    // headline is index 0 in layers array → should be first in fields
    expect(body.fields[0].name).toBe("headline");
    expect(body.fields[1].name).toBe("background");
  });
});
