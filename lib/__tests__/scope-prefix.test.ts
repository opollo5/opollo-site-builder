import { describe, it, expect } from "vitest";
import { validateScopedCss } from "@/lib/scope-prefix";

describe("validateScopedCss", () => {
  it("passes a single prefixed selector", () => {
    const r = validateScopedCss(".ls-hero { padding: 2rem; }", "ls");
    expect(r.valid).toBe(true);
  });

  it("passes nested prefixed selectors", () => {
    const css = `
      .ls-hero .ls-btn { font-weight: 500; }
      .ls-hero__eyebrow::before { content: ''; }
    `;
    expect(validateScopedCss(css, "ls").valid).toBe(true);
  });

  it("passes element selectors without classes", () => {
    const css = `
      .ls-scope h1 { font-size: 88px; }
      .ls-scope a { color: var(--ls-blue); }
    `;
    expect(validateScopedCss(css, "ls").valid).toBe(true);
  });

  it("rejects an unprefixed class selector", () => {
    const r = validateScopedCss(".hero { padding: 2rem; }", "ls");
    expect(r.valid).toBe(false);
    if (r.valid) return;
    expect(r.violations).toEqual([{ selector: ".hero", line: 1 }]);
  });

  it("rejects a foreign-prefixed class selector", () => {
    const r = validateScopedCss(".p6-hero { padding: 2rem; }", "ls");
    expect(r.valid).toBe(false);
    if (r.valid) return;
    expect(r.violations[0].selector).toBe(".p6-hero");
  });

  it("reports line numbers correctly with multiple violations", () => {
    const css =
      "\n" +
      ".ls-hero { padding: 2rem; }\n" +
      ".nope { color: red; }\n" +
      "\n" +
      ".another-nope { color: blue; }\n";
    const r = validateScopedCss(css, "ls");
    expect(r.valid).toBe(false);
    if (r.valid) return;
    expect(r.violations).toEqual([
      { selector: ".nope", line: 3 },
      { selector: ".another-nope", line: 5 },
    ]);
  });

  it("ignores class-looking fragments inside block comments", () => {
    const css = `
      /* .hero-old-name was the legacy class */
      .ls-hero { padding: 2rem; }
    `;
    expect(validateScopedCss(css, "ls").valid).toBe(true);
  });

  it("ignores class-looking fragments inside url(...) values", () => {
    const css = `
      .ls-check::before {
        background-image: url("data:image/svg+xml,%3Csvg.path/class%3E");
      }
    `;
    expect(validateScopedCss(css, "ls").valid).toBe(true);
  });

  it("does not treat decimal numbers like 1.4em as class selectors", () => {
    const css = `.ls-box { line-height: 1.4; padding: 1.4em; }`;
    expect(validateScopedCss(css, "ls").valid).toBe(true);
  });

  it("handles multiple selectors on one line with mixed validity", () => {
    const r = validateScopedCss(".ls-a, .ls-b, .bad { color: red; }", "ls");
    expect(r.valid).toBe(false);
    if (r.valid) return;
    expect(r.violations.map((v) => v.selector)).toEqual([".bad"]);
  });

  it("throws if called with an empty prefix", () => {
    expect(() => validateScopedCss(".ls-hero {}", "")).toThrow();
  });

  it("validates the real LeadSource base-styles.css as clean", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const css = fs.readFileSync(
      path.join(process.cwd(), "seed/leadsource/base-styles.css"),
      "utf-8",
    );
    const r = validateScopedCss(css, "ls");
    expect(r.valid).toBe(true);
  });
});
