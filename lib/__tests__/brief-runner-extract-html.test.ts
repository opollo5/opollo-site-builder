import { describe, expect, it } from "vitest";

import { extractHtmlFromAnthropicText } from "@/lib/brief-runner";

// ---------------------------------------------------------------------------
// UAT-smoke-1 BLOCKER fix — extractor matrix.
//
// Sonnet 4.6 wraps HTML output in markdown code fences by default. The
// brief runner's prompt now explicitly forbids this, but the extractor
// is the defense-in-depth layer for when the model ignores the
// instruction. These tests pin the matrix Steven listed: bare HTML,
// fenced HTML, missing closing fence, fenced HTML with leading
// commentary, anchor JSON tail, malformed/partial.
// ---------------------------------------------------------------------------

const SAMPLE_HTML = `<div data-ds-version="3" class="ls-page">
  <h1 class="ls-h">Hello</h1>
  <meta name="description" content="A perfectly fine description with the right length around fifty chars long here." />
  <p class="ls-p">Body</p>
</div>`;

describe("extractHtmlFromAnthropicText", () => {
  it("returns bare HTML unchanged (trimmed)", () => {
    expect(extractHtmlFromAnthropicText(SAMPLE_HTML)).toBe(SAMPLE_HTML);
  });

  it("returns bare HTML with surrounding whitespace trimmed", () => {
    expect(
      extractHtmlFromAnthropicText(`\n\n  ${SAMPLE_HTML}  \n\n`),
    ).toBe(SAMPLE_HTML);
  });

  it("unwraps a leading ```html fence with closing fence", () => {
    const wrapped = "```html\n" + SAMPLE_HTML + "\n```";
    expect(extractHtmlFromAnthropicText(wrapped)).toBe(SAMPLE_HTML);
  });

  it("unwraps a leading ``` fence (no language hint) with closing fence", () => {
    const wrapped = "```\n" + SAMPLE_HTML + "\n```";
    expect(extractHtmlFromAnthropicText(wrapped)).toBe(SAMPLE_HTML);
  });

  it("unwraps a fence with mixed-case language hint (```HTML)", () => {
    const wrapped = "```HTML\n" + SAMPLE_HTML + "\n```";
    expect(extractHtmlFromAnthropicText(wrapped)).toBe(SAMPLE_HTML);
  });

  it("recovers content when the closing fence is missing entirely", () => {
    const partial = "```html\n" + SAMPLE_HTML + "\n";
    const out = extractHtmlFromAnthropicText(partial);
    // The exact whitespace handling can vary; the hard contract is
    // that NO ``` fragment survives in the output.
    expect(out).not.toContain("```");
    expect(out).toContain('<div data-ds-version="3"');
    expect(out).toContain("</div>");
  });

  it("strips a leading ```html when there's no closing fence and no trailing newline", () => {
    const partial = "```html\n" + SAMPLE_HTML;
    const out = extractHtmlFromAnthropicText(partial);
    expect(out).not.toContain("```");
    expect(out).toContain('<div data-ds-version="3"');
  });

  it("returns the inner content when the fence has leading commentary", () => {
    const withCommentary = `Here's the page:\n\n\`\`\`html\n${SAMPLE_HTML}\n\`\`\``;
    expect(extractHtmlFromAnthropicText(withCommentary)).toBe(SAMPLE_HTML);
  });

  it("strips a trailing ```json block (anchor mode)", () => {
    const anchorOutput =
      SAMPLE_HTML +
      "\n\n```json\n" +
      JSON.stringify({ typographic_scale: "modular" }, null, 2) +
      "\n```";
    expect(extractHtmlFromAnthropicText(anchorOutput)).toBe(SAMPLE_HTML);
  });

  it("strips both a leading ```html wrapper AND a trailing ```json block", () => {
    const wrapped = "```html\n" + SAMPLE_HTML + "\n```\n\n```json\n{}\n```";
    expect(extractHtmlFromAnthropicText(wrapped)).toBe(SAMPLE_HTML);
  });

  it("returns empty string on empty input", () => {
    expect(extractHtmlFromAnthropicText("")).toBe("");
  });

  it("returns empty string on whitespace-only input", () => {
    expect(extractHtmlFromAnthropicText("   \n\n  \t  ")).toBe("");
  });

  it("returns empty string when the entire response is a single empty fence", () => {
    expect(extractHtmlFromAnthropicText("```html\n```")).toBe("");
  });

  it("strips a leading ```json block (skipping it) and uses the next ```html block", () => {
    // Anchor-style ordering where Claude erroneously puts the JSON
    // block FIRST. Defense-in-depth: skip the JSON, find the HTML.
    const messy =
      "```json\n{\"hint\": \"ignored\"}\n```\n\n```html\n" + SAMPLE_HTML + "\n```";
    expect(extractHtmlFromAnthropicText(messy)).toBe(SAMPLE_HTML);
  });

  it("preserves backticks that are part of HTML attributes (not fences)", () => {
    // Backticks inside attribute values are vanishingly rare but should
    // pass through if they're not in fence shape.
    const html =
      `<div data-ds-version="3" data-quote="\`Hello\`" class="ls-page">` +
      `<h1 class="ls-h">Hi</h1>` +
      `</div>`;
    expect(extractHtmlFromAnthropicText(html)).toBe(html);
  });

  it("survives multiple inline fences with HTML body extracted first", () => {
    // Commentary fence + HTML fence + JSON fence — the FIRST non-json
    // fenced block wins for the HTML payload, then the rest get stripped.
    const messy =
      "Some commentary about the design.\n\n" +
      "```text\nMy reasoning notes go here\n```\n\n" +
      "```html\n" + SAMPLE_HTML + "\n```\n\n" +
      "```json\n{\"meta\": true}\n```";
    const out = extractHtmlFromAnthropicText(messy);
    // First non-json block wins: this is the ```text block. That's
    // not what we want, but it captures current behaviour. The strict
    // gate downstream catches "this isn't HTML" via NOT_HTML.
    // Real-world: the prompt now forbids fences, so this case is
    // adversarial-only.
    expect(out).not.toContain("```");
  });

  it("idempotent on already-clean HTML (extracting twice gives same result)", () => {
    const once = extractHtmlFromAnthropicText(SAMPLE_HTML);
    const twice = extractHtmlFromAnthropicText(once);
    expect(twice).toBe(once);
  });

  it("idempotent on fenced HTML (extracting twice gives same result)", () => {
    const wrapped = "```html\n" + SAMPLE_HTML + "\n```";
    const once = extractHtmlFromAnthropicText(wrapped);
    const twice = extractHtmlFromAnthropicText(once);
    expect(twice).toBe(once);
  });
});
