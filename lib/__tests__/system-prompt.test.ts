import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderComponentSummary,
  renderRegistryBlock,
  renderTemplateSummary,
} from "@/lib/design-system-prompt";
import {
  buildSystemPromptForSite,
  isDesignSystemV2Enabled,
  loadActiveRegistry,
} from "@/lib/system-prompt";
import {
  createDesignSystem,
  activateDesignSystem,
  type DesignSystem,
} from "@/lib/design-systems";
import { createComponent, type DesignComponent } from "@/lib/components";
import { createTemplate, type DesignTemplate } from "@/lib/templates";
import { minimalComponentContentSchema, minimalComposition, seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// Pure render tests — no DB, synthetic input.
// ---------------------------------------------------------------------------

function fakeComponent(overrides: Partial<DesignComponent> = {}): DesignComponent {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    design_system_id: "00000000-0000-0000-0000-000000000002",
    name: "hero-centered",
    variant: "default",
    category: "hero",
    html_template: "<section>...</section>",
    css: ".ls-hero { padding: 2rem; }",
    content_schema: {
      type: "object",
      required: ["headline", "sub"],
      properties: {
        headline: { type: "string" },
        sub: { type: "string" },
      },
    },
    image_slots: null,
    usage_notes: "Default hero.\nSecond line should be dropped.",
    preview_html: null,
    version_lock: 1,
    created_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

function fakeTemplate(overrides: Partial<DesignTemplate> = {}): DesignTemplate {
  return {
    id: "00000000-0000-0000-0000-000000000010",
    design_system_id: "00000000-0000-0000-0000-000000000002",
    page_type: "homepage",
    name: "homepage-default",
    composition: [
      { component: "nav-default", content_source: "site_context.nav" },
      { component: "hero-centered", content_source: "brief.hero" },
      { component: "footer-default", content_source: "site_context.footer" },
    ],
    required_fields: { hero: ["headline"] },
    seo_defaults: null,
    is_default: true,
    version_lock: 1,
    created_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

function fakeDesignSystem(overrides: Partial<DesignSystem> = {}): DesignSystem {
  return {
    id: "00000000-0000-0000-0000-000000000002",
    site_id: "00000000-0000-0000-0000-000000000003",
    version: 1,
    status: "active",
    tokens_css: ".ls-scope {\n  --ls-blue: #185FA5;\n}",
    base_styles: ".ls-container { max-width: 1160px; }",
    notes: null,
    created_by: null,
    created_at: "2026-04-01T00:00:00Z",
    activated_at: "2026-04-02T00:00:00Z",
    archived_at: null,
    version_lock: 1,
    ...overrides,
  };
}

describe("renderComponentSummary", () => {
  it("renders name, category/variant, purpose, and required fields", () => {
    const out = renderComponentSummary(fakeComponent());
    expect(out).toContain("hero-centered [hero/default]");
    expect(out).toContain("Default hero.");
    expect(out).toContain("Required fields: headline, sub");
  });

  it("drops the variant when null", () => {
    const out = renderComponentSummary(fakeComponent({ variant: null }));
    expect(out).toContain("hero-centered [hero]");
    expect(out).not.toContain("[hero/");
  });

  it("uses only the first line of usage_notes", () => {
    const out = renderComponentSummary(fakeComponent());
    expect(out).not.toContain("Second line should be dropped.");
  });

  it("omits the purpose segment entirely when usage_notes is empty", () => {
    const out = renderComponentSummary(fakeComponent({ usage_notes: null }));
    expect(out.startsWith("- hero-centered")).toBe(true);
    expect(out).not.toContain(" — ");
  });

  it("omits the fields line when content_schema.required is missing or invalid", () => {
    const out = renderComponentSummary(
      fakeComponent({ content_schema: { type: "object" } }),
    );
    expect(out).not.toContain("Required fields:");
  });
});

describe("renderTemplateSummary", () => {
  it("renders name, page type, default flag, and composition", () => {
    const out = renderTemplateSummary(fakeTemplate());
    expect(out).toContain("homepage-default [homepage] (default)");
    expect(out).toContain(
      "Composition: nav-default → hero-centered → footer-default",
    );
  });

  it("drops the default tag when is_default is false", () => {
    const out = renderTemplateSummary(fakeTemplate({ is_default: false }));
    expect(out).not.toContain("(default)");
  });

  it("handles empty composition gracefully", () => {
    const out = renderTemplateSummary(fakeTemplate({ composition: [] }));
    expect(out).toContain("homepage-default [homepage]");
    expect(out).not.toContain("Composition:");
  });
});

describe("renderRegistryBlock", () => {
  it("puts components in category-then-name order and templates in page_type-then-name order", () => {
    const block = renderRegistryBlock({
      site_name: "LeadSource",
      prefix: "ls",
      ds: fakeDesignSystem(),
      components: [
        fakeComponent({ name: "footer-default", category: "footer", variant: null }),
        fakeComponent({ name: "hero-centered", category: "hero", variant: "default" }),
        fakeComponent({ name: "nav-default", category: "nav", variant: "default" }),
      ],
      templates: [
        fakeTemplate({ name: "integration-gravity", page_type: "integration" }),
        fakeTemplate({ name: "homepage-default", page_type: "homepage" }),
      ],
    });

    expect(block).toContain("# Site: LeadSource");
    expect(block).toContain("# Design system version: 1");
    expect(block).toContain("# Scope prefix: ls-");
    expect(block).toContain("## Available components (3 total)");
    expect(block).toContain("## Page templates (2 total)");
    expect(block).toContain("--ls-blue: #185FA5");
    expect(block).toContain(`<div class="ls-scope">`);

    // Category ordering: footer → hero → nav
    const footerIdx = block.indexOf("footer-default");
    const heroIdx = block.indexOf("hero-centered");
    const navIdx = block.indexOf("nav-default");
    expect(footerIdx).toBeLessThan(heroIdx);
    expect(heroIdx).toBeLessThan(navIdx);

    // Template ordering: homepage → integration
    const homeTmpl = block.indexOf("homepage-default [homepage]");
    const intTmpl = block.indexOf("integration-gravity [integration]");
    expect(homeTmpl).toBeLessThan(intTmpl);
  });

  it("renders empty sections without crashing", () => {
    const block = renderRegistryBlock({
      site_name: "Empty",
      prefix: "em",
      ds: fakeDesignSystem(),
      components: [],
      templates: [],
    });
    expect(block).toContain("## Available components (0 total)");
    expect(block).toContain("## Page templates (0 total)");
    expect(block).toContain("(none registered)");
  });
});

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

describe("isDesignSystemV2Enabled", () => {
  const original = process.env.FEATURE_DESIGN_SYSTEM_V2;

  afterEach(() => {
    if (original === undefined) delete process.env.FEATURE_DESIGN_SYSTEM_V2;
    else process.env.FEATURE_DESIGN_SYSTEM_V2 = original;
  });

  it("treats 'true' and '1' as enabled", () => {
    process.env.FEATURE_DESIGN_SYSTEM_V2 = "true";
    expect(isDesignSystemV2Enabled()).toBe(true);
    process.env.FEATURE_DESIGN_SYSTEM_V2 = "1";
    expect(isDesignSystemV2Enabled()).toBe(true);
  });

  it("treats anything else as disabled", () => {
    process.env.FEATURE_DESIGN_SYSTEM_V2 = "false";
    expect(isDesignSystemV2Enabled()).toBe(false);
    process.env.FEATURE_DESIGN_SYSTEM_V2 = "0";
    expect(isDesignSystemV2Enabled()).toBe(false);
    process.env.FEATURE_DESIGN_SYSTEM_V2 = "";
    expect(isDesignSystemV2Enabled()).toBe(false);
    delete process.env.FEATURE_DESIGN_SYSTEM_V2;
    expect(isDesignSystemV2Enabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration: loadActiveRegistry + buildSystemPromptForSite against real DB.
// ---------------------------------------------------------------------------

async function seedActiveDesignSystem(siteId: string): Promise<{
  ds: DesignSystem;
  componentName: string;
  templateName: string;
}> {
  const dsRes = await createDesignSystem({
    site_id: siteId,
    version: 1,
    tokens_css: ".ls-scope { --ls-blue: #185FA5; }",
    base_styles: ".ls-container { max-width: 1160px; }",
  });
  if (!dsRes.ok) throw new Error(`createDesignSystem: ${dsRes.error.message}`);

  const compRes = await createComponent({
    design_system_id: dsRes.data.id,
    name: "hero-centered",
    variant: "default",
    category: "hero",
    html_template: "<section>{{headline}}</section>",
    css: ".ls-hero {}",
    content_schema: minimalComponentContentSchema(),
    usage_notes: "Homepage hero.",
  });
  if (!compRes.ok) throw new Error(`createComponent: ${compRes.error.message}`);

  const tmplRes = await createTemplate({
    design_system_id: dsRes.data.id,
    page_type: "homepage",
    name: "homepage-default",
    composition: minimalComposition(),
    required_fields: { hero: ["headline"] },
    is_default: true,
  });
  if (!tmplRes.ok) throw new Error(`createTemplate: ${tmplRes.error.message}`);

  const activated = await activateDesignSystem(
    dsRes.data.id,
    dsRes.data.version_lock,
  );
  if (!activated.ok) {
    throw new Error(`activateDesignSystem: ${activated.error.message}`);
  }

  return {
    ds: activated.data,
    componentName: compRes.data.name,
    templateName: tmplRes.data.name,
  };
}

describe("loadActiveRegistry", () => {
  it("returns null when the site has no active design system", async () => {
    const site = await seedSite();
    const result = await loadActiveRegistry(site.id);
    expect(result).toBeNull();
  });

  it("returns ds + components + templates when an active DS exists", async () => {
    const site = await seedSite();
    const seeded = await seedActiveDesignSystem(site.id);
    const result = await loadActiveRegistry(site.id);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.ds.id).toBe(seeded.ds.id);
    expect(result.components.map((c) => c.name)).toContain(seeded.componentName);
    expect(result.templates.map((t) => t.name)).toContain(seeded.templateName);
  });
});

describe("buildSystemPromptForSite", () => {
  const originalFlag = process.env.FEATURE_DESIGN_SYSTEM_V2;
  // Spy hoisted to describe scope + eagerly initialised so afterEach can
  // always call mockRestore(), including when an upstream beforeEach (e.g.
  // the global truncate in _setup.ts) throws and skips the inner
  // beforeEach. Previously the spy was created in beforeEach; an upstream
  // failure left it undefined and afterEach cascaded into a second error.
  const errorSpy = vi
    .spyOn(console, "error")
    .mockImplementation(() => {});

  beforeEach(() => {
    // Reset call history between tests. The spy itself outlives the
    // describe and is restored once in afterAll.
    errorSpy.mockClear();
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.FEATURE_DESIGN_SYSTEM_V2;
    else process.env.FEATURE_DESIGN_SYSTEM_V2 = originalFlag;
  });

  afterAll(() => {
    errorSpy.mockRestore();
  });

  it("uses legacy path when flag is off, even with active DS", async () => {
    delete process.env.FEATURE_DESIGN_SYSTEM_V2;
    const site = await seedSite();
    await seedActiveDesignSystem(site.id);

    const prompt = await buildSystemPromptForSite({
      id: site.id,
      site_name: "Test",
      prefix: site.prefix,
      design_system_version: "1.0.0",
    });

    // Legacy path fills {{design_system_html_full_file}} with empty string,
    // so the heading markers from the registry block are absent.
    expect(prompt).not.toContain("## Available components");
    expect(prompt).not.toContain("## Page templates");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("uses legacy path when id is missing, regardless of flag", async () => {
    process.env.FEATURE_DESIGN_SYSTEM_V2 = "true";
    const prompt = await buildSystemPromptForSite({
      site_name: "Fallback",
      prefix: "fb",
      design_system_version: "1.0.0",
    });
    expect(prompt).not.toContain("## Available components");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("uses new path when flag is on and active DS exists", async () => {
    process.env.FEATURE_DESIGN_SYSTEM_V2 = "true";
    const site = await seedSite();
    await seedActiveDesignSystem(site.id);

    const prompt = await buildSystemPromptForSite({
      id: site.id,
      site_name: "Test",
      prefix: site.prefix,
      design_system_version: "1.0.0",
    });

    expect(prompt).toContain("## Available components (1 total)");
    expect(prompt).toContain("## Page templates (1 total)");
    expect(prompt).toContain("hero-centered [hero/default]");
    expect(prompt).toContain("homepage-default [homepage] (default)");
    expect(prompt).toContain("--ls-blue: #185FA5");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("falls back to legacy and logs structured error when flag is on but no active DS", async () => {
    process.env.FEATURE_DESIGN_SYSTEM_V2 = "true";
    const site = await seedSite();

    const prompt = await buildSystemPromptForSite({
      id: site.id,
      site_name: "Test",
      prefix: site.prefix,
      design_system_version: "1.0.0",
    });

    expect(prompt).not.toContain("## Available components");
    expect(errorSpy).toHaveBeenCalledWith(
      "[system-prompt] FEATURE_DESIGN_SYSTEM_V2=on but no active design_system for site",
      expect.objectContaining({
        site_id: site.id,
        site_name: "Test",
        fallback: "legacy_html_blob",
      }),
    );
  });
});
