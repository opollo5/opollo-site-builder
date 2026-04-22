import { describe, expect, it } from "vitest";

import {
  ALL_GATES,
  gateHtmlBasics,
  gateHtmlSize,
  gateMetaDescription,
  gateScopePrefix,
  gateSlugKebab,
  gateWrapper,
  HTML_SIZE_MAX_BYTES,
  runGates,
  type GateContext,
} from "@/lib/quality-gates";

// ---------------------------------------------------------------------------
// M3-5 — Quality gate unit tests.
//
// Every gate tested in isolation with a minimal ctx, then a handful
// of integration assertions on runGates (order, short-circuit).
// ---------------------------------------------------------------------------

function ctx(overrides: Partial<GateContext>): GateContext {
  return {
    html: "<section></section>",
    slug: "hello",
    prefix: "ls",
    design_system_version: "1",
    ...overrides,
  };
}

function validHtml(): string {
  // Used by multiple tests as the "all gates pass" baseline.
  return `
    <section class="ls-hero" data-ds-version="1">
      <h1>Hello</h1>
      <p>Body <a href="/somewhere">link</a></p>
      <img src="/a.png" alt="descriptive" class="ls-img"/>
      <meta name="description" content="A descriptive meta summary of the page that is comfortably between fifty and one hundred sixty characters." />
    </section>
  `;
}

// ---------------------------------------------------------------------------
// gateWrapper (HC-2)
// ---------------------------------------------------------------------------

describe("gateWrapper", () => {
  it("passes when outermost element has matching data-ds-version", () => {
    const r = gateWrapper(
      ctx({ html: '<section data-ds-version="1">x</section>' }),
    );
    expect(r.kind).toBe("pass");
  });

  it("fails when data-ds-version is missing", () => {
    const r = gateWrapper(ctx({ html: "<section>x</section>" }));
    expect(r.kind).toBe("fail");
    if (r.kind !== "fail") return;
    expect(r.reason).toMatch(/data-ds-version/);
  });

  it("fails when data-ds-version mismatches", () => {
    const r = gateWrapper(
      ctx({
        html: '<section data-ds-version="7">x</section>',
        design_system_version: "1",
      }),
    );
    expect(r.kind).toBe("fail");
    if (r.kind !== "fail") return;
    expect((r.details as { expected: string }).expected).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// gateScopePrefix (HC-4)
// ---------------------------------------------------------------------------

describe("gateScopePrefix", () => {
  it("passes when every class is prefixed", () => {
    const r = gateScopePrefix(
      ctx({
        html:
          '<div class="ls-hero"><span class="ls-hero-title"></span></div>',
        prefix: "ls",
      }),
    );
    expect(r.kind).toBe("pass");
  });

  it("fails on a non-prefixed class", () => {
    const r = gateScopePrefix(
      ctx({
        html: '<div class="ls-hero rogue-class">x</div>',
        prefix: "ls",
      }),
    );
    expect(r.kind).toBe("fail");
    if (r.kind !== "fail") return;
    expect((r.details as { violations: string[] }).violations).toContain(
      "rogue-class",
    );
  });

  it("rejects a bare prefix without a suffix (ls on its own)", () => {
    const r = gateScopePrefix(
      ctx({ html: '<div class="ls">x</div>', prefix: "ls" }),
    );
    expect(r.kind).toBe("fail");
  });

  it("rejects inverted prefix (hero-ls)", () => {
    const r = gateScopePrefix(
      ctx({ html: '<div class="hero-ls">x</div>', prefix: "ls" }),
    );
    expect(r.kind).toBe("fail");
  });
});

// ---------------------------------------------------------------------------
// gateHtmlBasics
// ---------------------------------------------------------------------------

describe("gateHtmlBasics", () => {
  it("passes the baseline valid HTML", () => {
    const r = gateHtmlBasics(ctx({ html: validHtml() }));
    expect(r.kind).toBe("pass");
  });

  it("fails on zero h1 tags", () => {
    const r = gateHtmlBasics(
      ctx({ html: '<section data-ds-version="1"><p>no heading</p></section>' }),
    );
    expect(r.kind).toBe("fail");
    if (r.kind !== "fail") return;
    expect(r.reason).toMatch(/h1/);
  });

  it("fails on two h1 tags", () => {
    const r = gateHtmlBasics(
      ctx({
        html:
          '<section data-ds-version="1"><h1>a</h1><h1>b</h1></section>',
      }),
    );
    expect(r.kind).toBe("fail");
  });

  it("fails on empty href", () => {
    const r = gateHtmlBasics(
      ctx({ html: '<h1>x</h1><a href="">y</a>' }),
    );
    expect(r.kind).toBe("fail");
    if (r.kind !== "fail") return;
    expect(r.reason).toMatch(/placeholder|empty href/i);
  });

  it("fails on href=\"#\"", () => {
    const r = gateHtmlBasics(
      ctx({ html: '<h1>x</h1><a href="#">y</a>' }),
    );
    expect(r.kind).toBe("fail");
  });

  it("fails on img missing alt", () => {
    const r = gateHtmlBasics(
      ctx({ html: '<h1>x</h1><img src="/a.png"/>' }),
    );
    expect(r.kind).toBe("fail");
    if (r.kind !== "fail") return;
    expect(r.reason).toMatch(/alt/);
  });

  it("fails on img with empty alt", () => {
    const r = gateHtmlBasics(
      ctx({ html: '<h1>x</h1><img src="/a.png" alt=""/>' }),
    );
    expect(r.kind).toBe("fail");
  });
});

// ---------------------------------------------------------------------------
// gateSlugKebab
// ---------------------------------------------------------------------------

describe("gateSlugKebab", () => {
  it("passes for valid kebab-case", () => {
    expect(gateSlugKebab(ctx({ slug: "hello-world" })).kind).toBe("pass");
    expect(gateSlugKebab(ctx({ slug: "version-2" })).kind).toBe("pass");
    expect(gateSlugKebab(ctx({ slug: "single" })).kind).toBe("pass");
  });

  it("fails for uppercase", () => {
    expect(gateSlugKebab(ctx({ slug: "Hello" })).kind).toBe("fail");
  });

  it("fails for double hyphens", () => {
    expect(gateSlugKebab(ctx({ slug: "hello--world" })).kind).toBe("fail");
  });

  it("fails for leading hyphen", () => {
    expect(gateSlugKebab(ctx({ slug: "-hello" })).kind).toBe("fail");
  });

  it("fails for trailing hyphen", () => {
    expect(gateSlugKebab(ctx({ slug: "hello-" })).kind).toBe("fail");
  });

  it("fails for underscores", () => {
    expect(gateSlugKebab(ctx({ slug: "hello_world" })).kind).toBe("fail");
  });

  it("fails for missing slug", () => {
    expect(gateSlugKebab(ctx({ slug: null })).kind).toBe("fail");
  });
});

// ---------------------------------------------------------------------------
// gateMetaDescription
// ---------------------------------------------------------------------------

describe("gateMetaDescription", () => {
  it("passes with a 50-160 char description", () => {
    const desc = "A descriptive meta summary of the page that is comfortably between fifty and one hundred sixty characters.";
    const r = gateMetaDescription(
      ctx({
        html: `<meta name="description" content="${desc}"/>`,
      }),
    );
    expect(r.kind).toBe("pass");
  });

  it("fails when no meta description is present", () => {
    const r = gateMetaDescription(ctx({ html: "<h1>x</h1>" }));
    expect(r.kind).toBe("fail");
  });

  it("fails when meta description is too short", () => {
    const r = gateMetaDescription(
      ctx({
        html: '<meta name="description" content="too short"/>',
      }),
    );
    expect(r.kind).toBe("fail");
    if (r.kind !== "fail") return;
    expect(r.reason).toMatch(/length/);
  });

  it("fails when meta description is too long", () => {
    const long = "x".repeat(200);
    const r = gateMetaDescription(
      ctx({ html: `<meta name="description" content="${long}"/>` }),
    );
    expect(r.kind).toBe("fail");
  });

  it("accepts reversed attribute order (content before name)", () => {
    const desc = "A descriptive meta summary of the page that is comfortably between fifty and one hundred sixty characters.";
    const r = gateMetaDescription(
      ctx({
        html: `<meta content="${desc}" name="description"/>`,
      }),
    );
    expect(r.kind).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// runGates — order + short-circuit
// ---------------------------------------------------------------------------

describe("runGates", () => {
  it("passes the baseline valid HTML", () => {
    const r = runGates(ctx({ html: validHtml() }));
    expect(r.kind).toBe("passed");
    if (r.kind !== "passed") return;
    expect(r.gates_run).toEqual(ALL_GATES.map((g) => g.name));
  });

  it("short-circuits on first failure and names the gate", () => {
    // Wrapper missing → html_size passes (tiny body), then wrapper
    // fails; later gates never run.
    const r = runGates(ctx({ html: "<section><h1>x</h1></section>" }));
    expect(r.kind).toBe("failed");
    if (r.kind !== "failed") return;
    expect(r.first_failure.gate).toBe("wrapper");
    expect(r.gates_run).toEqual(["html_size", "wrapper"]);
  });

  it("runs multiple gates in order when earlier ones pass", () => {
    // Valid size, valid wrapper, valid scope prefix, but zero h1 →
    // fails at html_basics (fourth gate).
    const r = runGates(
      ctx({
        html:
          '<section data-ds-version="1" class="ls-hero"><p>no h1 here</p></section>',
      }),
    );
    expect(r.kind).toBe("failed");
    if (r.kind !== "failed") return;
    expect(r.first_failure.gate).toBe("html_basics");
    expect(r.gates_run).toEqual([
      "html_size",
      "wrapper",
      "scope_prefix",
      "html_basics",
    ]);
  });

  it("short-circuits at html_size before the regex-heavy gates touch an oversized payload", () => {
    // Payload well over the 500KB cap. Even though the wrapper is
    // missing and every other gate would fail, the runner must stop
    // at html_size so we don't waste CPU scanning a 1MB string.
    const oversize = "<section>" + "a".repeat(HTML_SIZE_MAX_BYTES + 1) + "</section>";
    const r = runGates(ctx({ html: oversize }));
    expect(r.kind).toBe("failed");
    if (r.kind !== "failed") return;
    expect(r.first_failure.gate).toBe("html_size");
    expect(r.gates_run).toEqual(["html_size"]);
    expect(r.first_failure.details?.code).toBe("HTML_TOO_LARGE");
  });
});

// ---------------------------------------------------------------------------
// gateHtmlSize (M11-4)
// ---------------------------------------------------------------------------

describe("gateHtmlSize", () => {
  it("passes for a comfortably-sized HTML payload", () => {
    const r = gateHtmlSize(ctx({ html: validHtml() }));
    expect(r.kind).toBe("pass");
  });

  it("passes at exactly the cap (boundary)", () => {
    const atCap = "a".repeat(HTML_SIZE_MAX_BYTES);
    const r = gateHtmlSize(ctx({ html: atCap }));
    expect(r.kind).toBe("pass");
  });

  it("fails one byte over the cap with HTML_TOO_LARGE details", () => {
    const overCap = "a".repeat(HTML_SIZE_MAX_BYTES + 1);
    const r = gateHtmlSize(ctx({ html: overCap }));
    expect(r.kind).toBe("fail");
    if (r.kind !== "fail") return;
    expect(r.gate).toBe("html_size");
    expect(r.details?.code).toBe("HTML_TOO_LARGE");
    expect(r.details?.actual_bytes).toBe(HTML_SIZE_MAX_BYTES + 1);
    expect(r.details?.cap_bytes).toBe(HTML_SIZE_MAX_BYTES);
    expect(r.reason).toMatch(/over/i);
  });
});
