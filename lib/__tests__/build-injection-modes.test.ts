import { afterEach, describe, expect, it } from "vitest";

import { renderInjection } from "@/lib/design-discovery/build-injection";

// Pure-function tests for renderInjection's mode dispatch. Doesn't
// touch the DB loader; covers the two write-safety-critical
// branches:
//
//   1. copy_existing emits <existing_theme_context> regardless of
//      DESIGN_CONTEXT_ENABLED so onboarded copy_existing sites don't
//      depend on the legacy flag.
//   2. new_design with the flag off returns the empty string —
//      preserves the pre-PR-10 behaviour for sites that haven't
//      explicitly opted into the new context injection.

const ORIGINAL_FLAG = process.env.DESIGN_CONTEXT_ENABLED;

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.DESIGN_CONTEXT_ENABLED;
  else process.env.DESIGN_CONTEXT_ENABLED = ORIGINAL_FLAG;
});

describe("renderInjection — copy_existing", () => {
  it("emits theme context regardless of DESIGN_CONTEXT_ENABLED", () => {
    delete process.env.DESIGN_CONTEXT_ENABLED;
    const result = renderInjection({
      site_mode: "copy_existing",
      design_direction_status: null,
      tone_of_voice_status: null,
      design_tokens: null,
      homepage_concept_html: null,
      tone_applied_homepage_html: null,
      tone_of_voice: null,
      extracted_design: {
        colors: {
          primary: "#1f2937",
          secondary: "#6b7280",
          accent: null,
          background: "#ffffff",
          text: "#111111",
        },
        fonts: { heading: "Inter", body: "Inter" },
        layout_density: "spacious",
        visual_tone: "Premium",
      },
      extracted_css_classes: {
        container: "wp-container",
        headings: { h1: "page-title", h2: null, h3: null },
        button: "btn-primary",
        card: "feature-card",
      },
    });
    expect(result).toContain("<existing_theme_context>");
    expect(result).toContain("primary: #1f2937");
    expect(result).toContain("container: .wp-container");
    expect(result).toContain("button: .btn-primary");
    expect(result).not.toContain("<design_context>");
    expect(result).not.toContain("<voice_context>");
  });

  it("returns empty string when both extracted columns are null", () => {
    process.env.DESIGN_CONTEXT_ENABLED = "true";
    const result = renderInjection({
      site_mode: "copy_existing",
      design_direction_status: null,
      tone_of_voice_status: null,
      design_tokens: null,
      homepage_concept_html: null,
      tone_applied_homepage_html: null,
      tone_of_voice: null,
      extracted_design: null,
      extracted_css_classes: null,
    });
    expect(result.trim()).toBe("");
  });
});

describe("renderInjection — new_design", () => {
  it("returns empty string when the flag is off", () => {
    delete process.env.DESIGN_CONTEXT_ENABLED;
    const result = renderInjection({
      site_mode: "new_design",
      design_direction_status: "approved",
      tone_of_voice_status: "approved",
      design_tokens: { primary: "#000000" },
      homepage_concept_html: "<section>hi</section>",
      tone_applied_homepage_html: null,
      tone_of_voice: { style_guide: "Be brief.", approved_samples: [] },
      extracted_design: null,
      extracted_css_classes: null,
    });
    expect(result).toBe("");
  });

  it("emits design_context + voice_context when flag is on and statuses approved", () => {
    process.env.DESIGN_CONTEXT_ENABLED = "true";
    const result = renderInjection({
      site_mode: "new_design",
      design_direction_status: "approved",
      tone_of_voice_status: "approved",
      design_tokens: { primary: "#000000", font_heading: "Inter" },
      homepage_concept_html: "<section>hi</section>",
      tone_applied_homepage_html: null,
      tone_of_voice: {
        style_guide: "Be brief.",
        approved_samples: [{ kind: "hero", text: "Welcome." }],
      },
      extracted_design: null,
      extracted_css_classes: null,
    });
    expect(result).toContain("<design_context>");
    expect(result).toContain("primary: #000000");
    expect(result).toContain("<voice_context>");
    expect(result).toContain("style_guide:");
    expect(result).toContain("hero: Welcome.");
  });
});

describe("renderInjection — null mode", () => {
  it("returns empty string when site_mode IS NULL and flag is off", () => {
    delete process.env.DESIGN_CONTEXT_ENABLED;
    const result = renderInjection({
      site_mode: null,
      design_direction_status: null,
      tone_of_voice_status: null,
      design_tokens: null,
      homepage_concept_html: null,
      tone_applied_homepage_html: null,
      tone_of_voice: null,
      extracted_design: null,
      extracted_css_classes: null,
    });
    expect(result).toBe("");
  });
});
