import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// M6-4 — UX-debt de-jargon regression fence.
//
// Label changes have no behaviour surface, so a render test is overkill.
// Instead, assert the old raw-column-name strings are gone from the
// design-system authoring modals and the new operator-friendly copy is
// present. If someone reverts a label in a future edit, this trips.
//
// Not testing CreateDesignSystemModal's filenames (tokens.css /
// base-styles.css) — those are deliberately preserved. We DO assert
// the sub-label text landed.
// ---------------------------------------------------------------------------

function readComponent(filename: string): string {
  return readFileSync(
    resolve(__dirname, "..", "..", "components", filename),
    "utf8",
  );
}

describe("UX-debt labels — de-jargon pass (M6-4)", () => {
  describe("TemplateFormModal.tsx", () => {
    const src = readComponent("TemplateFormModal.tsx");

    it("replaces 'Composition (JSON array)' with 'Template composition'", () => {
      expect(src).not.toContain("Composition (JSON array)");
      expect(src).toContain("Template composition");
    });

    it("replaces 'required_fields (JSON)' with 'Required fields per component'", () => {
      expect(src).not.toContain("required_fields (JSON)");
      expect(src).toContain("Required fields per component");
    });

    it("replaces 'seo_defaults JSON (optional)' with 'SEO defaults (optional)'", () => {
      expect(src).not.toContain("seo_defaults JSON (optional)");
      expect(src).toContain("SEO defaults (optional)");
    });
  });

  describe("ComponentFormModal.tsx", () => {
    const src = readComponent("ComponentFormModal.tsx");

    it("replaces 'content_schema (JSON)' with 'Content shape (JSON Schema)'", () => {
      expect(src).not.toContain("content_schema (JSON)");
      expect(src).toContain("Content shape (JSON Schema)");
    });

    it("replaces 'image_slots JSON (optional)' with 'Image slots (optional)'", () => {
      expect(src).not.toContain("image_slots JSON (optional)");
      expect(src).toContain("Image slots (optional)");
    });
  });

  describe("CreateDesignSystemModal.tsx", () => {
    const src = readComponent("CreateDesignSystemModal.tsx");

    it("keeps tokens.css as the Label (designers write CSS; filename is accurate)", () => {
      expect(src).toContain(">tokens.css<");
    });

    it("keeps base-styles.css as the Label", () => {
      expect(src).toContain(">base-styles.css<");
    });

    it("adds a sub-label explaining what tokens.css controls", () => {
      expect(src).toContain("Design tokens");
    });

    it("adds a sub-label explaining what base-styles.css controls", () => {
      expect(src).toContain("Baseline component styles");
    });
  });
});
