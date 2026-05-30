/**
 * D3 unit tests — get_template() schema_version dispatch + resolvedTemplate.
 *
 * Tests the toTemplate() conversion logic:
 *  - schema_version=1 rows: resolvedTemplate absent, definition typed as TemplateDefinition
 *  - schema_version=2 rows: resolvedTemplate populated from definition JSONB
 *  - Missing schema_version column (pre-D1 reads): defaults to 1
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock supabase — we're testing the TypeScript mapping, not the DB.
const { mockMaybeSingle, mockSelect } = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const select = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle,
  });
  return { mockMaybeSingle: maybeSingle, mockSelect: select };
});
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({ select: mockSelect }),
  }),
}));

import { get_template } from "@/lib/image/templates/index";
import { TEMPLATE_SCHEMA_VERSION, LEGACY_SCHEMA_VERSION } from "@/lib/image/template-model";

// ─── Row fixtures ─────────────────────────────────────────────────────────────

const V1_ROW = {
  id: "tmpl_v1",
  company_id: null,
  name: "default",
  aspect_ratio: "16x9",
  definition: {
    compositionType: "split_layout",
    overlayAlpha: 0.75,
    logoPosition: "bottom-right",
    logoSizePercent: 18,
    logoPadding: 20,
    maxHeadlineFontSize: 120,
    fontFamily: "Inter",
  },
  version: 1,
  schema_version: 1,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const V2_ROW = {
  id: "tmpl_v2",
  company_id: null,
  name: "podcast",
  aspect_ratio: "16x9",
  definition: {
    // Minimal v2 Template shape
    id: "tmpl_v2",
    version: 2,
    name: "Podcast Thumbnail",
    width: 1280, height: 720,
    orientation: "landscape",
    background_color: "#2B0B5E",
    layers: [],
    groups: [],
    fonts: [],
    variants: [],
    render_settings: { format: "png", quality: 100, scale: 1, dpi: 72 },
    settings: { guides: false },
  },
  version: 3,
  schema_version: 2,
  is_active: true,
  created_at: "2026-02-01T00:00:00Z",
  updated_at: "2026-02-01T00:00:00Z",
};

const PRE_D1_ROW = {
  ...V1_ROW,
  schema_version: undefined, // column doesn't exist yet (pre-migration read)
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("get_template — schema_version dispatch (D3)", () => {
  it("schema_version=1: schemaVersion matches LEGACY_SCHEMA_VERSION", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: V1_ROW, error: null });
    const tmpl = await get_template("company_abc", "16x9");
    expect(tmpl).not.toBeNull();
    expect(tmpl!.schemaVersion).toBe(LEGACY_SCHEMA_VERSION);
    expect(tmpl!.schemaVersion).toBe(1);
  });

  it("schema_version=1: resolvedTemplate is undefined", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: V1_ROW, error: null });
    const tmpl = await get_template("company_abc", "16x9");
    expect(tmpl!.resolvedTemplate).toBeUndefined();
  });

  it("schema_version=1: definition is the legacy TemplateDefinition", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: V1_ROW, error: null });
    const tmpl = await get_template("company_abc", "16x9");
    expect((tmpl!.definition as { compositionType: string }).compositionType).toBe("split_layout");
  });

  it("schema_version=2: schemaVersion matches TEMPLATE_SCHEMA_VERSION", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: V2_ROW, error: null });
    const tmpl = await get_template("company_abc", "16x9", "podcast");
    expect(tmpl!.schemaVersion).toBe(TEMPLATE_SCHEMA_VERSION);
    expect(tmpl!.schemaVersion).toBe(2);
  });

  it("schema_version=2: resolvedTemplate is populated from definition JSONB", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: V2_ROW, error: null });
    const tmpl = await get_template("company_abc", "16x9", "podcast");
    expect(tmpl!.resolvedTemplate).toBeDefined();
    expect(tmpl!.resolvedTemplate!.width).toBe(1280);
    expect(tmpl!.resolvedTemplate!.height).toBe(720);
    expect(tmpl!.resolvedTemplate!.background_color).toBe("#2B0B5E");
  });

  it("schema_version=2: resolvedTemplate.layers is an array", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: V2_ROW, error: null });
    const tmpl = await get_template("company_abc", "16x9", "podcast");
    expect(Array.isArray(tmpl!.resolvedTemplate!.layers)).toBe(true);
  });

  it("pre-D1 row (schema_version undefined): defaults to 1, no resolvedTemplate", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: PRE_D1_ROW, error: null });
    const tmpl = await get_template("company_abc", "16x9");
    expect(tmpl!.schemaVersion).toBe(1);
    expect(tmpl!.resolvedTemplate).toBeUndefined();
  });

  it("returns null on DB error", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: "DB error" } });
    const tmpl = await get_template("company_abc", "16x9");
    expect(tmpl).toBeNull();
  });

  it("returns null when no template found", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const tmpl = await get_template("company_abc", "16x9");
    expect(tmpl).toBeNull();
  });
});

describe("schema version constants", () => {
  it("LEGACY_SCHEMA_VERSION = 1", () => expect(LEGACY_SCHEMA_VERSION).toBe(1));
  it("TEMPLATE_SCHEMA_VERSION = 2", () => expect(TEMPLATE_SCHEMA_VERSION).toBe(2));
});
