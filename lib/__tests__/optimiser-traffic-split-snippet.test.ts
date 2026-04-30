import { describe, expect, it } from "vitest";

import { renderTrafficSplitSnippet } from "@/lib/optimiser/ab-testing/traffic-split-snippet";

// OPTIMISER PHASE 1.5 follow-up slice C — JS hash traffic split.

describe("renderTrafficSplitSnippet", () => {
  const goodCfg = {
    test_id: "test-abc-123",
    traffic_split_percent: 50,
    variant_a_url: "https://example.com/page",
    variant_b_url: "https://example.com/page-b",
    this_variant: "A" as const,
  };

  it("emits a self-contained <script> with the config payload", () => {
    const out = renderTrafficSplitSnippet(goodCfg);
    expect(out).toContain("Opollo A/B traffic split");
    expect(out).toContain("test-abc-123");
    expect(out).toContain('"a":"https://example.com/page"');
    expect(out).toContain('"b":"https://example.com/page-b"');
    expect(out).toContain('"v":"A"');
    expect(out).toContain('"s":50');
  });

  it("rejects this_variant values other than A or B", () => {
    expect(() =>
      renderTrafficSplitSnippet({ ...goodCfg, this_variant: "C" as never }),
    ).toThrow(/this_variant must be/);
  });

  it("rejects traffic_split_percent outside 1..99", () => {
    expect(() =>
      renderTrafficSplitSnippet({ ...goodCfg, traffic_split_percent: 0 }),
    ).toThrow(/integer 1..99/);
    expect(() =>
      renderTrafficSplitSnippet({ ...goodCfg, traffic_split_percent: 100 }),
    ).toThrow(/integer 1..99/);
    expect(() =>
      renderTrafficSplitSnippet({ ...goodCfg, traffic_split_percent: 33.5 }),
    ).toThrow(/integer 1..99/);
  });

  it("rejects an unsafe test_id", () => {
    expect(() =>
      renderTrafficSplitSnippet({ ...goodCfg, test_id: "abc'); alert(1) //" }),
    ).toThrow(/safe id chars/);
  });

  it("rejects empty variant URLs", () => {
    expect(() =>
      renderTrafficSplitSnippet({ ...goodCfg, variant_a_url: "" }),
    ).toThrow(/variant_a_url and variant_b_url required/);
    expect(() =>
      renderTrafficSplitSnippet({ ...goodCfg, variant_b_url: "" }),
    ).toThrow(/variant_a_url and variant_b_url required/);
  });

  it("escapes URLs through JSON.stringify so quotes don't break the snippet", () => {
    const out = renderTrafficSplitSnippet({
      ...goodCfg,
      variant_a_url: 'https://example.com/page?x="y"&z=1',
    });
    // JSON.stringify produces \" inside the literal — the script is
    // still a valid JS object literal and never breaks out of the
    // string context.
    expect(out).toContain('\\"y\\"');
    expect(out).not.toContain('a":"https://example.com/page?x="y"');
  });

  it("includes the visitor-id mint, hash, and assignment branches", () => {
    const out = renderTrafficSplitSnippet(goodCfg);
    // Sanity-check the three load-bearing pieces of the algorithm.
    expect(out).toContain("opollo_vid");
    expect(out).toContain("opollo_v_");
    expect(out).toContain("location.replace");
    expect(out).toContain("history.replaceState");
    expect(out).toContain("setItem");
    expect(out).toContain("getItem");
  });
});
