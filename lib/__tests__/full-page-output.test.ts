import { describe, expect, it } from "vitest";

import { composeFullPage } from "@/lib/full-page-output";

// OPTIMISER PHASE 1.5 SLICE 14 — full-page composition matrix.

const baseChrome = {
  header_html: "<header><h1>Brand</h1></header>",
  nav_html: "<nav><ul><li>Home</li></ul></nav>",
  footer_html: "<footer>© Brand</footer>",
  source_url: "https://example.com",
  extracted_at: "2026-04-30T00:00:00Z",
};

describe("composeFullPage", () => {
  it("emits a complete standalone document", () => {
    const html = composeFullPage({
      fragmentHtml: '<section data-opollo="hero"><h1>Hi</h1></section>',
      cssBundle: ".hero { color: red; }",
      chrome: baseChrome,
      tracking: {},
      meta: { title: "Test page" },
    });

    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<title>Test page</title>");
    expect(html).toContain("<header>");
    expect(html).toContain("<nav>");
    expect(html).toContain("<footer>");
    expect(html).toContain("<main>");
    expect(html).toContain('<section data-opollo="hero">');
    expect(html).toContain(".hero { color: red; }");
  });

  it("escapes the title and description in head", () => {
    const html = composeFullPage({
      fragmentHtml: "<section></section>",
      cssBundle: "",
      chrome: baseChrome,
      tracking: {},
      meta: {
        title: 'Title with <script>alert("x")</script>',
        description: "Quote: \" and <tag>",
      },
    });
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot; and &lt;tag&gt;");
  });

  it("renders GA4 + Google Ads pixels when tracking_config provides them", () => {
    const html = composeFullPage({
      fragmentHtml: "<section></section>",
      cssBundle: "",
      chrome: baseChrome,
      tracking: {
        ga4_measurement_id: "G-ABC1234",
        google_ads_conversion_id: "AW-987654321",
        google_ads_conversion_label: "abc-Cl1ck",
      },
      meta: { title: "Pixel page" },
    });
    expect(html).toContain("googletagmanager.com/gtag/js?id=G-ABC1234");
    expect(html).toContain("gtag('config', 'G-ABC1234')");
    expect(html).toContain("googletagmanager.com/gtag/js?id=AW-987654321");
    expect(html).toContain("opolloTrackConversion");
    expect(html).toContain(
      "send_to: 'AW-987654321/abc-Cl1ck'",
    );
    expect(html).toContain("googleadservices.com/pagead/conversion/987654321");
  });

  it("omits all pixels when tracking_config is empty", () => {
    const html = composeFullPage({
      fragmentHtml: "<section></section>",
      cssBundle: "",
      chrome: baseChrome,
      tracking: {},
      meta: { title: "No pixels" },
    });
    expect(html).not.toContain("googletagmanager");
    expect(html).not.toContain("googleadservices");
    expect(html).not.toContain("opolloTrackConversion");
  });

  it("omits the conversion event helper when ads id is set without a label", () => {
    const html = composeFullPage({
      fragmentHtml: "<section></section>",
      cssBundle: "",
      chrome: baseChrome,
      tracking: { google_ads_conversion_id: "AW-1" },
      meta: { title: "Half-configured" },
    });
    expect(html).toContain("AW-1");
    expect(html).not.toContain("opolloTrackConversion");
    expect(html).not.toContain("noscript"); // noscript pixel needs both id + label
  });

  it("includes canonical + og:image when provided", () => {
    const html = composeFullPage({
      fragmentHtml: "<section></section>",
      cssBundle: "",
      chrome: baseChrome,
      tracking: {},
      meta: {
        title: "OG page",
        description: "Open graph test",
        canonical_url: "https://example.com/page",
        og_image_url: "https://example.com/og.png",
      },
    });
    expect(html).toContain(
      '<link rel="canonical" href="https://example.com/page">',
    );
    expect(html).toContain(
      '<meta property="og:url" content="https://example.com/page">',
    );
    expect(html).toContain(
      '<meta property="og:image" content="https://example.com/og.png">',
    );
  });

  it("supports custom lang attribute", () => {
    const html = composeFullPage({
      fragmentHtml: "<section></section>",
      cssBundle: "",
      chrome: baseChrome,
      tracking: {},
      meta: { title: "Localised", lang: "es-ES" },
    });
    expect(html).toContain('<html lang="es-ES">');
  });

  it("omits empty chrome sections without leaving blank lines in output", () => {
    const html = composeFullPage({
      fragmentHtml: "<section></section>",
      cssBundle: "",
      chrome: {
        header_html: "",
        nav_html: "<nav></nav>",
        footer_html: "",
        source_url: "https://example.com",
        extracted_at: "2026-04-30T00:00:00Z",
      },
      tracking: {},
      meta: { title: "Sparse" },
    });
    expect(html).toContain("<nav></nav>");
    expect(html).not.toMatch(/\n\n\n/);
  });

  it("does not inject a <style> block when cssBundle is empty", () => {
    const html = composeFullPage({
      fragmentHtml: "<section></section>",
      cssBundle: "",
      chrome: baseChrome,
      tracking: {},
      meta: { title: "No CSS" },
    });
    expect(html).not.toContain("<style>");
  });

  it("emits the JS hash traffic-split snippet before the title when abSplit is set", () => {
    const html = composeFullPage({
      fragmentHtml: "<section></section>",
      cssBundle: "",
      chrome: baseChrome,
      tracking: {},
      meta: { title: "Variant A" },
      abSplit: {
        test_id: "test-abc-123",
        traffic_split_percent: 50,
        variant_a_url: "https://example.com/page",
        variant_b_url: "https://example.com/page-b",
        this_variant: "A",
      },
    });
    expect(html).toContain("Opollo A/B traffic split");
    expect(html).toContain("test-abc-123");
    expect(html).toContain("opt_v");
    expect(html).toContain("opollo_vid");
    // charset must precede the snippet (HTML5 spec — first 1024 bytes)
    expect(html.indexOf('<meta charset="utf-8">')).toBeLessThan(
      html.indexOf("Opollo A/B traffic split"),
    );
    // and the snippet must precede the title
    expect(html.indexOf("Opollo A/B traffic split")).toBeLessThan(
      html.indexOf("<title>Variant A</title>"),
    );
  });

  it("omits the traffic-split snippet entirely when abSplit is undefined", () => {
    const html = composeFullPage({
      fragmentHtml: "<section></section>",
      cssBundle: "",
      chrome: baseChrome,
      tracking: {},
      meta: { title: "No test" },
    });
    expect(html).not.toContain("Opollo A/B traffic split");
    expect(html).not.toContain("opollo_vid");
  });
});
