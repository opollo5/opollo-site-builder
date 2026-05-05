import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  parseBriefDocument,
  type BriefParseResult,
} from "@/lib/brief-parser";
import type {
  AnthropicCallFn,
  AnthropicResponse,
} from "@/lib/anthropic-call";

// ---------------------------------------------------------------------------
// M12-1 brief-parser unit tests. Table-driven fixtures under
// __fixtures__/briefs/. The Claude inference fallback is exercised with
// a stubbed anthropicCall — tests never hit the real API.
// ---------------------------------------------------------------------------

function loadFixture(name: string): string {
  return readFileSync(
    resolve(__dirname, "__fixtures__/briefs", name),
    "utf8",
  );
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// Returns a Vitest mock typed as AnthropicCallFn. We cast via `unknown`
// because vi.fn's default generic resolves to a no-args Mock, which
// TypeScript sees as incompatible with the (req: AnthropicRequest)
// signature. The runtime behaviour is identical.
function stubAnthropic(text: string): AnthropicCallFn & { mock: { calls: Array<[typeof defaultCallArg]> } } {
  const response: AnthropicResponse = {
    id: "stub-msg-id",
    model: "claude-sonnet-4-6",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 50 },
  };
  const mock = vi.fn(async () => response);
  return mock as unknown as AnthropicCallFn & { mock: { calls: Array<[typeof defaultCallArg]> } };
}

// Helper for TS inference of the mock.calls[n][0] type.
const defaultCallArg: Parameters<AnthropicCallFn>[0] = {
  model: "",
  max_tokens: 0,
  system: "",
  messages: [],
  idempotency_key: "",
};

function expectOk(r: BriefParseResult): Extract<BriefParseResult, { ok: true }> {
  if (!r.ok) {
    throw new Error(`expected ok; got ${r.code}: ${r.detail}`);
  }
  return r;
}

function expectErr(r: BriefParseResult): Extract<BriefParseResult, { ok: false }> {
  if (r.ok) throw new Error("expected error; got ok");
  return r;
}

describe("brief-parser", () => {
  // -----------------------------------------------------------------------
  // 1. Valid markdown with H2 sections — structural path.
  // -----------------------------------------------------------------------
  it("valid-h2: 5 H2 sections → 5 pages, modes inferred by word count", async () => {
    const src = loadFixture("valid-h2.md");
    const result = await parseBriefDocument({
      briefId: "test-h2",
      source: src,
      sourceSha256: sha256Hex(src),
      anthropicCall: stubAnthropic("[]"),
    });
    const ok = expectOk(result);
    expect(ok.parser_mode).toBe("structural");
    expect(ok.pages).toHaveLength(5);
    expect(ok.pages.map((p) => p.title)).toEqual([
      "Home",
      "About",
      "Pricing",
      "Integrations",
      "Contact",
    ]);
    // Home is the long section (well over 400 words).
    expect(ok.pages[0].mode).toBe("full_text");
    expect(ok.pages[0].word_count).toBeGreaterThan(400);
    // Contact is short.
    expect(ok.pages[4].mode).toBe("short_brief");
    // Span offsets are populated.
    for (const p of ok.pages) {
      expect(p.source_span_start).not.toBeNull();
      expect(p.source_span_end).not.toBeNull();
      expect(p.source_span_end).toBeGreaterThan(p.source_span_start!);
      // source_text should be a substring of the document body at that
      // span, trimmed.
      expect(src.slice(p.source_span_start!, p.source_span_end!)).toContain(
        p.source_text.slice(0, 20),
      );
    }
  });

  // -----------------------------------------------------------------------
  // 2. Valid markdown with `---` separators — hrule path.
  // -----------------------------------------------------------------------
  it("valid-hrule: 3 sections separated by --- → 3 pages", async () => {
    const src = loadFixture("valid-hrule.md");
    const result = await parseBriefDocument({
      briefId: "test-hrule",
      source: src,
      sourceSha256: sha256Hex(src),
      anthropicCall: stubAnthropic("[]"),
    });
    const ok = expectOk(result);
    expect(ok.parser_mode).toBe("structural");
    expect(ok.pages).toHaveLength(3);
    expect(ok.pages.map((p) => p.title)).toEqual(["Home", "About", "Pricing"]);
  });

  // -----------------------------------------------------------------------
  // 3. "Page N: Title" — numbered path.
  // -----------------------------------------------------------------------
  it("valid-numbered: Page 1:/Page 2:/Page 3: → 3 pages", async () => {
    const src = loadFixture("valid-numbered.md");
    const result = await parseBriefDocument({
      briefId: "test-numbered",
      source: src,
      sourceSha256: sha256Hex(src),
      anthropicCall: stubAnthropic("[]"),
    });
    const ok = expectOk(result);
    expect(ok.parser_mode).toBe("structural");
    expect(ok.pages).toHaveLength(3);
    expect(ok.pages.map((p) => p.title)).toEqual(["Home", "About", "Pricing"]);
  });

  // -----------------------------------------------------------------------
  // 4. H1 fallback when no H2.
  // -----------------------------------------------------------------------
  it("valid-h1-fallback: 3 H1s (no H2) → 3 pages via H1-fallback", async () => {
    const src = loadFixture("valid-h1-fallback.md");
    const result = await parseBriefDocument({
      briefId: "test-h1",
      source: src,
      sourceSha256: sha256Hex(src),
      anthropicCall: stubAnthropic("[]"),
    });
    const ok = expectOk(result);
    expect(ok.parser_mode).toBe("structural");
    expect(ok.pages).toHaveLength(3);
    expect(ok.pages.map((p) => p.title)).toEqual(["Home", "About", "Pricing"]);
  });

  // -----------------------------------------------------------------------
  // 5. Empty document — rejected.
  // -----------------------------------------------------------------------
  it("empty: whitespace-only document → EMPTY_DOCUMENT", async () => {
    const src = loadFixture("empty.md");
    const result = await parseBriefDocument({
      briefId: "test-empty",
      source: src,
      sourceSha256: sha256Hex(src),
      anthropicCall: stubAnthropic("[]"),
    });
    const err = expectErr(result);
    expect(err.code).toBe("EMPTY_DOCUMENT");
  });

  // -----------------------------------------------------------------------
  // 6. Oversized document — NOT enforced by the parser itself.
  //    The upload route rejects with BRIEF_TOO_LARGE before calling the
  //    parser. This test documents that contract by asserting the parser
  //    happily consumes a large-but-parseable document.
  // -----------------------------------------------------------------------
  it("oversized: enforcement happens at the upload route, not the parser", async () => {
    const big = "## Long section\n\n" + "word ".repeat(1000);
    const result = await parseBriefDocument({
      briefId: "test-big",
      source: big,
      sourceSha256: sha256Hex(big),
      anthropicCall: stubAnthropic("[]"),
    });
    const ok = expectOk(result);
    expect(ok.parser_mode).toBe("structural");
    expect(ok.pages).toHaveLength(1);
    expect(ok.pages[0].word_count).toBeGreaterThan(500);
  });

  // -----------------------------------------------------------------------
  // 7. No structure → inference fallback.
  // -----------------------------------------------------------------------
  it("no-structure: prose-only → inference fallback; 4 valid entries → 4 pages", async () => {
    const src = loadFixture("no-structure.md");
    const entries = [
      { title: "Home", source_quote: "The home page should have a strong hero section with our tagline", mode: "short_brief" },
      { title: "About", source_quote: "The about page should tell our company story and introduce the team.", mode: "short_brief" },
      { title: "Pricing", source_quote: "The pricing page should show our three tiers — Starter which is free", mode: "short_brief" },
      { title: "Contact", source_quote: "The contact page should be simple with just a form and our office address.", mode: "short_brief" },
    ];

    const anthropicCall = stubAnthropic(JSON.stringify(entries));
    const result = await parseBriefDocument({
      briefId: "test-no-structure",
      source: src,
      sourceSha256: sha256Hex(src),
      anthropicCall,
    });
    const ok = expectOk(result);
    expect(ok.parser_mode).toBe("claude_inference");
    expect(ok.pages).toHaveLength(4);
    expect(ok.pages.map((p) => p.title)).toEqual([
      "Home",
      "About",
      "Pricing",
      "Contact",
    ]);
    // Each page's source_text is a verbatim slice of the source.
    for (const p of ok.pages) {
      expect(src).toContain(p.source_text.slice(0, 40));
    }
    // The stubbed call was invoked exactly once.
    expect(anthropicCall).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // 8. Malformed code fence — warn but parse.
  // -----------------------------------------------------------------------
  it("malformed-fence: unclosed ``` → warning + pages still emit", async () => {
    const src = loadFixture("malformed-fence.md");
    const result = await parseBriefDocument({
      briefId: "test-fence",
      source: src,
      sourceSha256: sha256Hex(src),
      anthropicCall: stubAnthropic("[]"),
    });
    const ok = expectOk(result);
    expect(ok.parser_mode).toBe("structural");
    expect(ok.pages.length).toBeGreaterThanOrEqual(2);
    expect(ok.warnings.some((w) => w.code === "UNCLOSED_CODE_FENCE")).toBe(
      true,
    );
  });

  // -----------------------------------------------------------------------
  // 9. Malformed frontmatter — warn, strip, parse remainder.
  // -----------------------------------------------------------------------
  it("malformed-frontmatter: stripped with warning; body parses normally", async () => {
    const src = loadFixture("malformed-frontmatter.md");
    const result = await parseBriefDocument({
      briefId: "test-fm",
      source: src,
      sourceSha256: sha256Hex(src),
      anthropicCall: stubAnthropic("[]"),
    });
    const ok = expectOk(result);
    expect(ok.parser_mode).toBe("structural");
    // At least Home + About.
    expect(ok.pages.length).toBeGreaterThanOrEqual(2);
    expect(ok.pages.some((p) => p.title === "Home")).toBe(true);
    expect(ok.warnings.some((w) => w.code === "MALFORMED_FRONTMATTER")).toBe(
      true,
    );
  });

  // -----------------------------------------------------------------------
  // 10. Inference returns only bogus quotes → single-page fallback.
  //
  // When all entries fail validation the parser falls back to treating the
  // whole source as a single page rather than failing outright.
  // INFERENCE_ENTRY_DROPPED warnings are stripped (noise on the review page)
  // and HEADING_HIERARCHY_SKIPPED is added to signal the fallback.
  // -----------------------------------------------------------------------
  it("inference-no-match: every entry fails validation → single-page fallback", async () => {
    const src = loadFixture("no-structure.md");
    const entries = [
      { title: "Ghost Page A", source_quote: "This string absolutely does not appear anywhere in the source document text you uploaded." },
      { title: "Ghost Page B", source_quote: "Another fabricated line that is also not present in the source at all ever." },
    ];
    const anthropicCall = stubAnthropic(JSON.stringify(entries));
    const result = await parseBriefDocument({
      briefId: "test-no-match",
      source: src,
      sourceSha256: sha256Hex(src),
      anthropicCall,
    });
    const ok = expectOk(result);
    expect(ok.pages).toHaveLength(1);
    expect(ok.warnings.some((w) => w.code === "HEADING_HIERARCHY_SKIPPED")).toBe(true);
    // INFERENCE_ENTRY_DROPPED warnings are stripped in the fallback path
    expect(ok.warnings.filter((w) => w.code === "INFERENCE_ENTRY_DROPPED").length).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 11. Inference returns partial matches — drop invalid, keep valid.
  // -----------------------------------------------------------------------
  it("inference-partial-match: 1 entry invalid → 3 kept + 1 warning", async () => {
    const src = loadFixture("no-structure.md");
    const entries = [
      { title: "Home", source_quote: "The home page should have a strong hero section with our tagline" },
      { title: "Ghost", source_quote: "This quote is absolutely not in the document anywhere and never will be." },
      { title: "About", source_quote: "The about page should tell our company story and introduce the team." },
      { title: "Contact", source_quote: "The contact page should be simple with just a form and our office address." },
    ];
    const anthropicCall = stubAnthropic(JSON.stringify(entries));
    const result = await parseBriefDocument({
      briefId: "test-partial",
      source: src,
      sourceSha256: sha256Hex(src),
      anthropicCall,
    });
    const ok = expectOk(result);
    expect(ok.parser_mode).toBe("claude_inference");
    expect(ok.pages).toHaveLength(3);
    expect(ok.pages.map((p) => p.title)).toEqual(["Home", "About", "Contact"]);
    expect(ok.warnings.some(
      (w) => w.code === "INFERENCE_ENTRY_DROPPED" && (w.detail ?? "").includes("Ghost"),
    )).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 12. Inference idempotency key — same brief_id + sha256 → same key.
  //     The key is passed to anthropicCall; tests observe it there.
  // -----------------------------------------------------------------------
  it("inference idempotency: same (brief_id, source_sha256) produces the same Anthropic key", async () => {
    const src = loadFixture("no-structure.md");
    const sha = sha256Hex(src);
    const entries = [
      { title: "Home", source_quote: "The home page should have a strong hero section with our tagline" },
    ];
    const callA = stubAnthropic(JSON.stringify(entries));
    const callB = stubAnthropic(JSON.stringify(entries));

    await parseBriefDocument({ briefId: "same-brief", source: src, sourceSha256: sha, anthropicCall: callA });
    await parseBriefDocument({ briefId: "same-brief", source: src, sourceSha256: sha, anthropicCall: callB });

    const keyA = callA.mock.calls[0][0].idempotency_key;
    const keyB = callB.mock.calls[0][0].idempotency_key;
    expect(keyA).toEqual(keyB);
    expect(keyA).toMatch(/^[a-f0-9]{64}$/);
  });
});
