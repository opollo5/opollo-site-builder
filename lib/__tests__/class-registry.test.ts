import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { extractCssClasses } from "@/lib/scope-prefix";
import {
  buildClassRegistry,
  extractHtmlClasses,
  validateHtmlClasses,
} from "@/lib/class-registry";

// ---------------------------------------------------------------------------
// extractCssClasses
// ---------------------------------------------------------------------------

describe("extractCssClasses", () => {
  it("picks up a single class selector", () => {
    const s = extractCssClasses(".ls-hero { padding: 2rem; }");
    expect([...s].sort()).toEqual(["ls-hero"]);
  });

  it("handles compound class selectors (.ls-card.ls-card--dark)", () => {
    const s = extractCssClasses(".ls-card.ls-card--dark { color: #000; }");
    expect([...s].sort()).toEqual(["ls-card", "ls-card--dark"]);
  });

  it("handles descendant and child selectors", () => {
    const s = extractCssClasses(
      ".ls-hero .ls-hero__title { font-size: 2rem; }\n" +
        ".ls-nav > .ls-nav__item { padding: 8px; }",
    );
    expect([...s].sort()).toEqual([
      "ls-hero",
      "ls-hero__title",
      "ls-nav",
      "ls-nav__item",
    ]);
  });

  it("handles negation (:not(.ls-btn--disabled))", () => {
    const s = extractCssClasses(
      ".ls-btn:not(.ls-btn--disabled) { cursor: pointer; }",
    );
    expect([...s].sort()).toEqual(["ls-btn", "ls-btn--disabled"]);
  });

  it("handles pseudo-classes and pseudo-elements", () => {
    const s = extractCssClasses(
      ".ls-btn:hover { } .ls-hero::before { }",
    );
    expect([...s].sort()).toEqual(["ls-btn", "ls-hero"]);
  });

  it("deduplicates across rules", () => {
    const s = extractCssClasses(
      ".ls-x { a: 1; } .ls-x { b: 2; } .ls-y .ls-x { c: 3; }",
    );
    expect([...s].sort()).toEqual(["ls-x", "ls-y"]);
  });

  it("ignores class-like fragments inside block comments", () => {
    const s = extractCssClasses(
      "/* .old-class was renamed */ .ls-hero { }",
    );
    expect([...s].sort()).toEqual(["ls-hero"]);
  });

  it("ignores class-like fragments inside url(...)", () => {
    const s = extractCssClasses(
      '.ls-check::before { background: url("data:image/svg+xml,%3Csvg .class .x /%3E"); }',
    );
    expect([...s].sort()).toEqual(["ls-check"]);
  });

  it("does not treat decimal numbers as classes", () => {
    const s = extractCssClasses(".ls-box { line-height: 1.4; padding: 1.4em; }");
    expect([...s].sort()).toEqual(["ls-box"]);
  });
});

// ---------------------------------------------------------------------------
// extractHtmlClasses
// ---------------------------------------------------------------------------

describe("extractHtmlClasses", () => {
  it("reads a double-quoted class attribute", () => {
    const s = extractHtmlClasses(`<div class="ls-hero">hi</div>`);
    expect([...s].sort()).toEqual(["ls-hero"]);
  });

  it("reads a single-quoted class attribute", () => {
    const s = extractHtmlClasses(`<div class='ls-hero'>hi</div>`);
    expect([...s].sort()).toEqual(["ls-hero"]);
  });

  it("reads an unquoted class attribute (HTML5)", () => {
    const s = extractHtmlClasses(`<div class=ls-hero>hi</div>`);
    expect([...s].sort()).toEqual(["ls-hero"]);
  });

  it("handles multiple space-separated classes", () => {
    const s = extractHtmlClasses(
      `<button class="ls-btn ls-btn--primary ls-btn--lg">x</button>`,
    );
    expect([...s].sort()).toEqual([
      "ls-btn",
      "ls-btn--lg",
      "ls-btn--primary",
    ]);
  });

  it("aggregates classes across nested children", () => {
    const s = extractHtmlClasses(
      `<section class="ls-hero"><h1 class="ls-hero__title">x</h1></section>`,
    );
    expect([...s].sort()).toEqual(["ls-hero", "ls-hero__title"]);
  });

  it("ignores Handlebars-style template holes like {{dynamic}} and {var}", () => {
    const s = extractHtmlClasses(
      `<div class="ls-hero {{dynamic}}">x</div>` +
        `<div class="ls-btn {var}">y</div>`,
    );
    expect([...s].sort()).toEqual(["ls-btn", "ls-hero"]);
  });

  it("returns empty Set when element has no class attribute", () => {
    const s = extractHtmlClasses(`<div>hi</div>`);
    expect([...s]).toEqual([]);
  });

  it("handles self-closing tags", () => {
    const s = extractHtmlClasses(`<img class="ls-avatar" />`);
    expect([...s].sort()).toEqual(["ls-avatar"]);
  });

  // Contract test: className= is JSX, not HTML. If M3 ever emits JSX, the
  // helper deliberately ignores it — so the validator's "unknown class"
  // list stays correct and doesn't pick up React runtime tokens.
  it("does NOT pick up className= (JSX contamination signal)", () => {
    const s = extractHtmlClasses(`<div className="ls-hero">hi</div>`);
    expect([...s]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildClassRegistry
// ---------------------------------------------------------------------------

describe("buildClassRegistry", () => {
  it("unions classes across tokens, base, and components", () => {
    const registry = buildClassRegistry({
      tokensCss: ".ls-scope { --ls-blue: #185FA5; }",
      baseStyles: ".ls-container { max-width: 1160px; }",
      componentCss: [
        ".ls-hero { padding: 2rem; } .ls-hero__title { font-size: 2rem; }",
        ".ls-footer { padding: 1rem; }",
      ],
    });
    expect([...registry].sort()).toEqual([
      "ls-container",
      "ls-footer",
      "ls-hero",
      "ls-hero__title",
      "ls-scope",
    ]);
  });

  it("dedups across inputs", () => {
    const registry = buildClassRegistry({
      tokensCss: ".ls-x {}",
      baseStyles: ".ls-x {}",
      componentCss: [".ls-x {} .ls-y {}"],
    });
    expect([...registry].sort()).toEqual(["ls-x", "ls-y"]);
  });

  it("merges in an explicit allowlist", () => {
    const registry = buildClassRegistry({
      tokensCss: "",
      baseStyles: ".ls-container {}",
      componentCss: [".ls-hero {}"],
      allowlist: ["sr-only", "visually-hidden"],
    });
    expect([...registry].sort()).toEqual([
      "ls-container",
      "ls-hero",
      "sr-only",
      "visually-hidden",
    ]);
  });

  it("returns an empty Set for empty inputs", () => {
    const registry = buildClassRegistry({
      tokensCss: "",
      baseStyles: "",
      componentCss: [],
    });
    expect(registry.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// validateHtmlClasses
// ---------------------------------------------------------------------------

describe("validateHtmlClasses", () => {
  const registry = new Set(["ls-hero", "ls-hero__title", "ls-btn"]);

  it("returns valid=true when all classes are registered", () => {
    const r = validateHtmlClasses(
      `<section class="ls-hero"><h1 class="ls-hero__title">x</h1></section>`,
      registry,
    );
    expect(r.valid).toBe(true);
  });

  it("returns valid=false with a single unknown class", () => {
    const r = validateHtmlClasses(
      `<div class="ls-hero ls-bogus">x</div>`,
      registry,
    );
    expect(r.valid).toBe(false);
    if (r.valid) return;
    expect(r.unknownClasses).toEqual(["ls-bogus"]);
  });

  it("deduplicates repeated unknown classes across the HTML", () => {
    const r = validateHtmlClasses(
      `<a class="ls-oops"></a><a class="ls-oops"></a>`,
      registry,
    );
    expect(r.valid).toBe(false);
    if (r.valid) return;
    expect(r.unknownClasses).toEqual(["ls-oops"]);
  });

  it("reports multiple distinct unknown classes", () => {
    const r = validateHtmlClasses(
      `<div class="ls-a ls-b ls-hero">x</div>`,
      registry,
    );
    expect(r.valid).toBe(false);
    if (r.valid) return;
    expect(r.unknownClasses.sort()).toEqual(["ls-a", "ls-b"]);
  });

  it("returns valid=true on HTML with no class attributes", () => {
    const r = validateHtmlClasses(`<div>x</div>`, registry);
    expect(r.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Acceptance: the real LeadSource seed
//
// Load every committed CSS file from seed/leadsource/, build the registry,
// and validate the 12 committed component HTML templates against it.
// Every ls-prefixed class reference has to resolve. This is the regression
// net that catches future extractions whose CSS and HTML drift apart.
//
// Template placeholders ({{field}}, {var}, Handlebars blocks) are skipped
// by extractHtmlClasses so the raw templates — not rendered output — can
// be validated directly.
// ---------------------------------------------------------------------------

function readSeed(relPath: string): string {
  return fs.readFileSync(
    path.join(process.cwd(), "seed/leadsource", relPath),
    "utf8",
  );
}

function listComponentNames(): string[] {
  const dir = path.join(process.cwd(), "seed/leadsource/components");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".html"))
    .map((f) => f.slice(0, -".html".length))
    .sort();
}

describe("class-registry: real LeadSource seed acceptance", () => {
  const componentNames = listComponentNames();
  const tokensCss = readSeed("tokens.css");
  const baseStyles = readSeed("base-styles.css");
  const componentCss = componentNames.map((n) =>
    readSeed(`components/${n}.css`),
  );
  const registry = buildClassRegistry({ tokensCss, baseStyles, componentCss });

  it("collects the expected breadth of registered classes", () => {
    // Sanity floor — number moves with seed changes; keep lax.
    expect(registry.size).toBeGreaterThanOrEqual(120);
    // Spot-check a handful of known classes.
    for (const cls of [
      "ls-hero",
      "ls-btn--primary",
      "ls-footer__grid",
      "ls-pricing",
      "ls-arc",
    ]) {
      expect(registry.has(cls)).toBe(true);
    }
  });

  it.each(componentNames)("component %s validates against the registry", (name) => {
    const html = readSeed(`components/${name}.html`);
    const result = validateHtmlClasses(html, registry);
    if (!result.valid) {
      // Make the failure message useful — which component, which classes.
      throw new Error(
        `Component "${name}" references unregistered classes: ${result.unknownClasses.join(", ")}`,
      );
    }
  });
});
