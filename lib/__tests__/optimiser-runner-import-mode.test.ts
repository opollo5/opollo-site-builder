import { describe, expect, it } from "vitest";

import {
  systemPromptFor,
  userPromptForDraft,
} from "@/lib/brief-runner";

// OPTIMISER PHASE 1.5 follow-up slice B — runner mode='import' prompts.
//
// These tests verify the prompt branches that fire when
// brief_pages.mode === 'import':
//   - system prompt explains reverse-engineering goal + tagged-input
//     prompt-injection defense
//   - draft prompt wraps source HTML in <source_html_to_reproduce>
//   - source HTML is truncated when over 100KB

function makeContext(overrides: Partial<{
  mode: "full_text" | "short_brief" | "import";
  source_text: string;
  title: string;
  brand_voice: string;
  design_direction: string;
}> = {}) {
  return {
    brief: {
      brand_voice: overrides.brand_voice ?? null,
      design_direction: overrides.design_direction ?? null,
    } as never,
    page: {
      title: overrides.title ?? "Test page",
      mode: overrides.mode ?? "import",
      ordinal: 0,
      source_text: overrides.source_text ?? "<html><body>source</body></html>",
      operator_notes: null,
    } as never,
    contentSummary: "",
    siteConventions: null,
    previousDraft: null,
    previousCritique: null,
    previousVisualCritique: null,
    sitePrefix: "test",
    designSystemVersion: "1",
    designContextPrefix: "",
    siteMode: null,
  };
}

describe("brief-runner mode='import' prompts", () => {
  it("systemPromptFor emits import-mode guidance for mode='import'", () => {
    const sys = systemPromptFor(makeContext({ mode: "import" }));
    expect(sys).toContain("reverse-engineering");
    expect(sys).toContain("STRUCTURAL INTENT");
    expect(sys).toContain("UNTRUSTED INPUT");
    expect(sys).toContain("source_html_to_reproduce");
    // Same OUTPUT FORMAT contract as content briefs
    expect(sys).toContain("data-opollo");
    expect(sys).toContain('data-ds-version="1"');
  });

  it("systemPromptFor uses content-brief guidance for mode='full_text'", () => {
    const sys = systemPromptFor(makeContext({ mode: "full_text" }));
    expect(sys).not.toContain("reverse-engineering");
    expect(sys).not.toContain("source_html_to_reproduce");
    expect(sys).toContain("CONTENT FRAGMENT");
    // Standard structural rules still present
    expect(sys).toContain("data-opollo");
  });

  it("userPromptForDraft wraps source HTML in <source_html_to_reproduce>", () => {
    const draft = userPromptForDraft(
      makeContext({
        mode: "import",
        source_text: '<html><body><h1>Hello</h1></body></html>',
      }),
    );
    expect(draft).toContain("<source_html_to_reproduce>");
    expect(draft).toContain("</source_html_to_reproduce>");
    expect(draft).toContain("<h1>Hello</h1>");
    expect(draft).toContain("Mode: import");
    expect(draft).toContain("STRUCTURAL INTENT");
  });

  it("userPromptForDraft does not wrap source for non-import modes", () => {
    const draft = userPromptForDraft(
      makeContext({
        mode: "full_text",
        source_text: "Plain content brief",
      }),
    );
    expect(draft).not.toContain("source_html_to_reproduce");
    expect(draft).toContain("Plain content brief");
  });

  it("truncates source HTML over 100KB and includes a truncation note", () => {
    const big = "x".repeat(150_000);
    const draft = userPromptForDraft(
      makeContext({ mode: "import", source_text: big }),
    );
    expect(draft).toContain("source HTML truncated to 100000 chars from 150000");
    // The truncated text should be present at the start, not the full
    // 150K bytes
    const sourceStart = draft.indexOf("<source_html_to_reproduce>");
    const sourceEnd = draft.indexOf("</source_html_to_reproduce>");
    const sourceBlockLength = sourceEnd - sourceStart;
    expect(sourceBlockLength).toBeLessThan(101_000);
  });
});
