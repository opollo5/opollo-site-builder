/**
 * Unit tests for template-field-mapper (Stream B §3.3).
 *
 * Tests cover:
 *  - mapFieldsToColumns: exact-name match, label-match fallback, unmatched required
 *  - rowToModifications: text/image/rectangle conversion, default values
 *  - validateMapping: required-field validation
 *  - isImageUrl: URL detection
 *
 * No server-only imports, no Supabase, no sharp — pure logic tests.
 */

import { describe, it, expect } from "vitest";
import {
  mapFieldsToColumns,
  rowToModifications,
  validateMapping,
  isImageUrl,
} from "@/lib/image/template-field-mapper";
import type { TemplateField } from "@/lib/image/template-model";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTextField(name: string, label: string, required = false, defaultValue = ""): TemplateField {
  return {
    name,
    type: "text",
    var: { label, required, default: defaultValue, category: "content", help: "" },
  };
}

function makeImageField(name: string, label: string, required = false): TemplateField {
  return {
    name,
    type: "image",
    var: { label, required, default: "", category: "media", help: "" },
  };
}

const FIELDS: TemplateField[] = [
  makeTextField("headline", "Headline Text", true),
  makeTextField("subheading", "Subheading", false, "Default sub"),
  makeImageField("bg_image", "Background Image", false),
];

// ─── mapFieldsToColumns ────────────────────────────────────────────────────────

describe("mapFieldsToColumns", () => {
  it("matches by exact field name (case-insensitive)", () => {
    const headers = ["HEADLINE", "subheading", "bg_image"];
    const result = mapFieldsToColumns(FIELDS, headers);

    expect(result.fields[0].matchedColumn).toBe("HEADLINE");
    expect(result.fields[0].matchMethod).toBe("name_exact");
    expect(result.fields[1].matchedColumn).toBe("subheading");
    expect(result.fields[2].matchedColumn).toBe("bg_image");
  });

  it("falls back to label match when name does not match", () => {
    // Headers use full labels only — neither matches any field name exactly.
    // "Headline Text" matches label of "headline" field (name = "headline").
    // "Sub Text" does NOT match name "subheading" or label "Subheading" → unmatched.
    // Use a field whose label differs significantly from its name.
    const specialField: TemplateField = {
      name: "cta_btn",
      type: "text",
      var: { label: "Call To Action Button", required: false, default: "", category: "content", help: "" },
    };
    const headers = ["Call To Action Button"];
    const result = mapFieldsToColumns([specialField], headers);

    expect(result.fields[0].matchedColumn).toBe("Call To Action Button");
    expect(result.fields[0].matchMethod).toBe("label_match");
  });

  it("prefers exact name match over label match", () => {
    // Both "headline" (name) and "Headline Text" (label) are present — name wins
    const headers = ["headline", "Headline Text"];
    const result = mapFieldsToColumns([makeTextField("headline", "Headline Text")], headers);

    expect(result.fields[0].matchedColumn).toBe("headline");
    expect(result.fields[0].matchMethod).toBe("name_exact");
  });

  it("marks unmatched required fields", () => {
    const headers = ["subheading"]; // headline is required but missing
    const result = mapFieldsToColumns(FIELDS, headers);

    expect(result.hasRequiredUnmatched).toBe(true);
    expect(result.unmatched_required).toContain("headline");
  });

  it("collects unused columns", () => {
    const headers = ["headline", "subheading", "bg_image", "extra_col"];
    const result = mapFieldsToColumns(FIELDS, headers);

    expect(result.unusedColumns).toEqual(["extra_col"]);
  });

  it("populates sample value from first row", () => {
    const headers = ["headline", "subheading"];
    const sampleRow = { headline: "Hello World", subheading: "Sub value" };
    const result = mapFieldsToColumns(FIELDS, headers, sampleRow);

    expect(result.fields[0].sampleValue).toBe("Hello World");
    expect(result.fields[1].sampleValue).toBe("Sub value");
    expect(result.fields[2].sampleValue).toBeNull(); // bg_image not in headers
  });

  it("returns null sample value when column not matched", () => {
    const headers = ["subheading"];
    const sampleRow = { subheading: "Sub" };
    const result = mapFieldsToColumns(FIELDS, headers, sampleRow);

    expect(result.fields[0].sampleValue).toBeNull(); // headline unmatched
  });
});

// ─── rowToModifications ────────────────────────────────────────────────────────

describe("rowToModifications", () => {
  it("converts text field to text modification", () => {
    const headers = ["headline", "subheading"];
    const mapping = mapFieldsToColumns(FIELDS, headers);
    const mods = rowToModifications({ headline: "My Title", subheading: "My Sub" }, mapping);

    expect(mods).toContainEqual({ name: "headline", text: "My Title" });
    expect(mods).toContainEqual({ name: "subheading", text: "My Sub" });
  });

  it("uses field default when cell is empty", () => {
    const headers = ["headline", "subheading"];
    const mapping = mapFieldsToColumns(FIELDS, headers);
    // subheading cell empty, has default "Default sub"
    const mods = rowToModifications({ headline: "Hi", subheading: "" }, mapping);

    expect(mods).toContainEqual({ name: "subheading", text: "Default sub" });
  });

  it("omits field when cell is empty and no default", () => {
    const headers = ["headline"];
    const mapping = mapFieldsToColumns(
      [{ name: "headline", type: "text", var: { label: "Headline", required: false, default: "", category: "content" as const, help: "" } }],
      headers,
    );
    const mods = rowToModifications({ headline: "" }, mapping);

    expect(mods).toHaveLength(0);
  });

  it("converts image field cell to image_url modification", () => {
    const headers = ["bg_image"];
    const mapping = mapFieldsToColumns(FIELDS, headers);
    const mods = rowToModifications({ bg_image: "https://example.com/img.jpg" }, mapping);

    expect(mods).toContainEqual({ name: "bg_image", image_url: "https://example.com/img.jpg" });
  });

  it("skips image field when cell value is not a URL", () => {
    const headers = ["bg_image"];
    const mapping = mapFieldsToColumns(FIELDS, headers);
    const mods = rowToModifications({ bg_image: "not-a-url" }, mapping);

    // Non-URL image value → no modification (must-have #4: graceful skip)
    expect(mods.find(m => m.name === "bg_image")).toBeUndefined();
  });

  it("converts rectangle field to color modification", () => {
    const rectField: TemplateField = {
      name: "bg_rect",
      type: "rectangle",
      var: { label: "Background Color", required: false, default: "", category: "branding", help: "" },
    };
    const headers = ["bg_rect"];
    const mapping = mapFieldsToColumns([rectField], headers);
    const mods = rowToModifications({ bg_rect: "#ff0000" }, mapping);

    expect(mods).toContainEqual({ name: "bg_rect", color: "#ff0000" });
  });
});

// ─── validateMapping ──────────────────────────────────────────────────────────

describe("validateMapping", () => {
  it("returns ok when all required fields are matched", () => {
    const headers = ["headline"];
    const mapping = mapFieldsToColumns(FIELDS, headers);
    expect(validateMapping(mapping)).toEqual({ ok: true });
  });

  it("returns error when a required field is unmatched", () => {
    const headers = ["subheading"]; // headline required but missing
    const mapping = mapFieldsToColumns(FIELDS, headers);
    const result = validateMapping(mapping);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("headline");
    }
  });
});

// ─── isImageUrl ───────────────────────────────────────────────────────────────

describe("isImageUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isImageUrl("https://example.com/img.jpg")).toBe(true);
    expect(isImageUrl("http://cdn.example.com/photo.png")).toBe(true);
  });

  it("rejects non-URL strings", () => {
    expect(isImageUrl("not-a-url")).toBe(false);
    expect(isImageUrl("ftp://example.com/file")).toBe(false);
    expect(isImageUrl("")).toBe(false);
    expect(isImageUrl("/relative/path.jpg")).toBe(false);
  });
});
