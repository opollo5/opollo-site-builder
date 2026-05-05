import { describe, expect, it } from "vitest";

import { buildPrompt } from "@/lib/image/generator/prompt-engine";

describe("buildPrompt", () => {
  it("includes style base and composition in output", () => {
    const p = buildPrompt({
      styleId: "clean_corporate",
      primaryColour: "#1A73E8",
      compositionType: "split_layout",
    });
    expect(p).toContain("professional corporate background");
    expect(p).toContain("asymmetric composition");
    expect(p).toContain("no text");
    expect(p).toContain("no words");
  });

  it("includes colour descriptor", () => {
    const p = buildPrompt({
      styleId: "minimal_modern",
      primaryColour: "#1A73E8", // blue
      compositionType: "gradient_fade",
    });
    expect(p).toContain("cool blue");
  });

  it("includes industry modifier when provided", () => {
    const p = buildPrompt({
      styleId: "clean_corporate",
      primaryColour: "#000000",
      compositionType: "full_background",
      industry: "Technology / SaaS",
    });
    expect(p).toContain("digital");
  });

  it("omits industry modifier for unknown industries", () => {
    const p = buildPrompt({
      styleId: "clean_corporate",
      primaryColour: "#000000",
      compositionType: "full_background",
      industry: "Underwater Basket Weaving",
    });
    // No crash, no unknown industry text
    expect(p).toContain("professional corporate background");
  });

  it("adds safe mode prefix when safeMode=true", () => {
    const p = buildPrompt({
      styleId: "editorial",
      primaryColour: "#FF0000",
      compositionType: "geometric",
      safeMode: true,
    });
    expect(p).toMatch(/^photographic realism/);
  });

  it("simplify=true strips optional modifiers", () => {
    const p = buildPrompt({
      styleId: "bold_promo",
      primaryColour: "#FF03A5",
      compositionType: "texture",
      industry: "Technology / SaaS",
      mood: "energetic",
      simplify: true,
    });
    // Simplified prompt omits industry and mood
    expect(p).not.toContain("digital");
    expect(p).not.toContain("energetic");
    expect(p).toContain("no text");
  });

  it("includes mood modifier when provided", () => {
    const p = buildPrompt({
      styleId: "minimal_modern",
      primaryColour: "#00E5A0",
      compositionType: "texture",
      mood: "serene",
    });
    expect(p).toContain("serene mood");
  });

  it("always ends with no-text clause", () => {
    const p = buildPrompt({
      styleId: "product_focus",
      primaryColour: "#FFFFFF",
      compositionType: "full_background",
    });
    expect(p).toMatch(/no typography$/);
  });
});
