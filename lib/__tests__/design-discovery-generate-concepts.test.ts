import { describe, expect, it } from "vitest";

import { extractJsonFromOutputTags } from "@/lib/design-discovery/generate-concepts";
import { normalizeConceptHtml } from "@/lib/design-discovery/normalize-html";

// ---------------------------------------------------------------------------
// PR 5 — concept generation orchestrator helpers.
// Pure-function tests; no Anthropic call, no Supabase. The full
// generate-concepts integration is exercised end-to-end manually
// (Anthropic isn't reachable from CI without a real key).
// ---------------------------------------------------------------------------

describe("extractJsonFromOutputTags", () => {
  it("parses JSON wrapped in <output>…</output>", () => {
    const text = `<output>{"rationale":"x","ok":true}</output>`;
    const out = extractJsonFromOutputTags(text);
    expect(out).toEqual({ rationale: "x", ok: true });
  });

  it("ignores text around the tags", () => {
    const text = `Here you go:\n<output>\n{"v":1}\n</output>\nthanks`;
    const out = extractJsonFromOutputTags(text);
    expect(out).toEqual({ v: 1 });
  });

  it("falls back to markdown fenced JSON when output tags are missing", () => {
    const text = "```json\n{\"v\":2}\n```";
    const out = extractJsonFromOutputTags(text);
    expect(out).toEqual({ v: 2 });
  });

  it("returns null when no JSON is present", () => {
    expect(extractJsonFromOutputTags("just prose, sorry")).toBeNull();
  });
});

describe("normalizeConceptHtml", () => {
  it("snaps padding values to the 8px grid", () => {
    const before = `<div style="padding: 12px 14px 6px 4px">x</div>`;
    const r = normalizeConceptHtml(before);
    expect(r.changed).toBe(true);
    expect(r.html).toContain("padding: 16px 16px 8px 8px");
  });

  it("preserves non-px tokens in mixed shorthand", () => {
    const before = `<div style="padding: 12px auto 0 4px">x</div>`;
    const r = normalizeConceptHtml(before);
    expect(r.html).toContain("padding: 16px auto 0 8px");
  });

  it("clamps absurdly large font-size values", () => {
    const before = `<h1 style="font-size: 200px">Big</h1>`;
    const r = normalizeConceptHtml(before);
    expect(r.changed).toBe(true);
    expect(r.html).toContain("font-size: 96px");
  });

  it("strips <script> tags defensively", () => {
    const before = `<style>x</style><script>alert(1)</script><p>ok</p>`;
    const r = normalizeConceptHtml(before);
    expect(r.html).not.toContain("<script");
    expect(r.warnings).toContain("stripped <script> tag(s)");
  });

  it("clamps prose max-width above 70ch", () => {
    const before = `<style>.prose{max-width: 90ch}</style>`;
    const r = normalizeConceptHtml(before);
    expect(r.html).toContain("max-width: 70ch");
  });

  it("leaves already-snapped values alone", () => {
    const before = `<div style="padding: 8px 16px">y</div>`;
    const r = normalizeConceptHtml(before);
    expect(r.changed).toBe(false);
    expect(r.html).toBe(before);
  });
});
