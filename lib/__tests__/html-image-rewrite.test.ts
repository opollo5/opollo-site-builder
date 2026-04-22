import { describe, expect, it } from "vitest";

import {
  extractCloudflareIds,
  rewriteImageUrls,
} from "@/lib/html-image-rewrite";

// ---------------------------------------------------------------------------
// M4-7 — HTML image URL rewriter tests.
//
// Pure string-in / string-out; no DB. Covers the matrix the parent
// plan calls out: src, srcset (multi-descriptor), style="background:
// url(...)", nested <picture>, data: URLs preserved, external URLs
// preserved, relative URLs preserved, missing mapping entries.
// ---------------------------------------------------------------------------

const CF_ID_A = "0123-cat";
const CF_ID_B = "4567-river";
const CF_URL_A = `https://imagedelivery.net/HASH-abc/${CF_ID_A}/public`;
const CF_URL_B = `https://imagedelivery.net/HASH-abc/${CF_ID_B}/thumbnail`;
const WP_URL_A = `https://client.example/wp-content/uploads/cat.jpg`;
const WP_URL_B = `https://client.example/wp-content/uploads/river.jpg`;

function buildMap(entries: Array<[string, string]>): Map<string, string> {
  return new Map(entries);
}

// ---------------------------------------------------------------------------
// extractCloudflareIds
// ---------------------------------------------------------------------------

describe("extractCloudflareIds", () => {
  it("finds every distinct cloudflare id in src / srcset / style", () => {
    const html = `
      <section>
        <img src="${CF_URL_A}" alt="x"/>
        <picture>
          <source srcset="${CF_URL_B} 1x, ${CF_URL_A} 2x" />
        </picture>
        <div style="background-image: url('${CF_URL_B}')"></div>
      </section>
    `;
    const ids = extractCloudflareIds(html);
    expect(ids.size).toBe(2);
    expect(ids.has(CF_ID_A)).toBe(true);
    expect(ids.has(CF_ID_B)).toBe(true);
  });

  it("returns empty set when no Cloudflare URLs are present", () => {
    expect(extractCloudflareIds("<img src='x.jpg'/>").size).toBe(0);
    expect(extractCloudflareIds("<p>hello</p>").size).toBe(0);
  });

  it("ignores imagedelivery-looking substrings outside URLs", () => {
    // Text content that mentions imagedelivery.net should NOT be
    // extracted because our regex requires the full URL shape.
    const html = `<p>We host at imagedelivery.net for images.</p>`;
    expect(extractCloudflareIds(html).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// rewriteImageUrls — happy path
// ---------------------------------------------------------------------------

describe("rewriteImageUrls — src attributes", () => {
  it("rewrites a single img src", () => {
    const html = `<img src="${CF_URL_A}" alt="x"/>`;
    const m = buildMap([[CF_ID_A, WP_URL_A]]);
    const { rewrittenHtml, usedIds, missedIds, rewriteCount } =
      rewriteImageUrls(html, m);
    expect(rewrittenHtml).toContain(WP_URL_A);
    expect(rewrittenHtml).not.toContain("imagedelivery.net");
    expect(usedIds.has(CF_ID_A)).toBe(true);
    expect(missedIds.size).toBe(0);
    expect(rewriteCount).toBe(1);
  });

  it("preserves external src URLs", () => {
    const html = `<img src="https://other.example/x.jpg" alt="x"/>`;
    const m = buildMap([[CF_ID_A, WP_URL_A]]);
    const { rewrittenHtml, rewriteCount } = rewriteImageUrls(html, m);
    expect(rewrittenHtml).toContain("https://other.example/x.jpg");
    expect(rewriteCount).toBe(0);
  });

  it("preserves data: URLs", () => {
    const html = `<img src="data:image/png;base64,AAAA" alt="x"/>`;
    const m = buildMap([[CF_ID_A, WP_URL_A]]);
    const { rewrittenHtml, rewriteCount } = rewriteImageUrls(html, m);
    expect(rewrittenHtml).toContain("data:image/png;base64,AAAA");
    expect(rewriteCount).toBe(0);
  });

  it("preserves relative URLs", () => {
    const html = `<img src="/wp-content/uploads/x.jpg" alt="x"/>`;
    const m = buildMap([[CF_ID_A, WP_URL_A]]);
    const { rewriteCount } = rewriteImageUrls(html, m);
    expect(rewriteCount).toBe(0);
  });

  it("records missedIds when a URL has no mapping entry", () => {
    const html = `<img src="${CF_URL_A}" alt="x"/>`;
    const { rewrittenHtml, usedIds, missedIds } = rewriteImageUrls(
      html,
      new Map(),
    );
    expect(rewrittenHtml).toContain(CF_URL_A); // unchanged
    expect(usedIds.size).toBe(0);
    expect(missedIds.has(CF_ID_A)).toBe(true);
  });
});

describe("rewriteImageUrls — srcset attributes", () => {
  it("rewrites every URL in a multi-descriptor srcset, preserving descriptors", () => {
    const html = `<img srcset="${CF_URL_A} 1x, ${CF_URL_B} 2x, /local.jpg 3x" />`;
    const m = buildMap([
      [CF_ID_A, WP_URL_A],
      [CF_ID_B, WP_URL_B],
    ]);
    const { rewrittenHtml, usedIds, rewriteCount } = rewriteImageUrls(html, m);
    expect(rewrittenHtml).toContain(`${WP_URL_A} 1x`);
    expect(rewrittenHtml).toContain(`${WP_URL_B} 2x`);
    expect(rewrittenHtml).toContain("/local.jpg 3x");
    expect(usedIds.size).toBe(2);
    expect(rewriteCount).toBe(2);
  });

  it("handles <source srcset=...> inside <picture>", () => {
    const html = `
      <picture>
        <source srcset="${CF_URL_A} 1x" media="(max-width: 600px)"/>
        <img src="${CF_URL_B}" alt="fallback"/>
      </picture>
    `;
    const m = buildMap([
      [CF_ID_A, WP_URL_A],
      [CF_ID_B, WP_URL_B],
    ]);
    const { rewrittenHtml, rewriteCount } = rewriteImageUrls(html, m);
    expect(rewrittenHtml).toContain(WP_URL_A);
    expect(rewrittenHtml).toContain(WP_URL_B);
    expect(rewriteCount).toBe(2);
  });
});

describe("rewriteImageUrls — style background-image", () => {
  it("rewrites URL inside style attribute (double-quoted)", () => {
    const html = `<div style="background-image: url('${CF_URL_A}'); color: red;"></div>`;
    const m = buildMap([[CF_ID_A, WP_URL_A]]);
    const { rewrittenHtml, rewriteCount } = rewriteImageUrls(html, m);
    expect(rewrittenHtml).toContain(WP_URL_A);
    expect(rewrittenHtml).toContain("color: red");
    expect(rewriteCount).toBe(1);
  });

  it("rewrites URL inside style attribute (single-quoted outer)", () => {
    const html = `<div style='background-image: url(${CF_URL_A});'></div>`;
    const m = buildMap([[CF_ID_A, WP_URL_A]]);
    const { rewriteCount, rewrittenHtml } = rewriteImageUrls(html, m);
    expect(rewriteCount).toBe(1);
    expect(rewrittenHtml).toContain(WP_URL_A);
  });

  it("preserves non-Cloudflare background URLs", () => {
    const html = `<div style="background-image: url('/local-bg.jpg');"></div>`;
    const m = buildMap([[CF_ID_A, WP_URL_A]]);
    const { rewriteCount, rewrittenHtml } = rewriteImageUrls(html, m);
    expect(rewriteCount).toBe(0);
    expect(rewrittenHtml).toContain("/local-bg.jpg");
  });
});

describe("rewriteImageUrls — combined", () => {
  it("handles a realistic page with mixed attributes + external assets", () => {
    const html = `
      <section class="ls-hero" data-ds-version="1">
        <h1>Title</h1>
        <img src="${CF_URL_A}" alt="a"/>
        <picture>
          <source srcset="${CF_URL_B} 1x, ${CF_URL_A} 2x"/>
          <img src="${CF_URL_B}" alt="b"/>
        </picture>
        <div style="background-image: url('${CF_URL_A}');"></div>
        <img src="https://external.example/z.png" alt="external"/>
        <img src="/local.jpg" alt="relative"/>
        <img src="data:image/png;base64,AAAA" alt="data"/>
      </section>
    `;
    const m = buildMap([
      [CF_ID_A, WP_URL_A],
      [CF_ID_B, WP_URL_B],
    ]);
    const { rewrittenHtml, usedIds, missedIds, rewriteCount } =
      rewriteImageUrls(html, m);
    expect(rewrittenHtml).not.toContain("imagedelivery.net");
    expect(rewrittenHtml).toContain("https://external.example/z.png");
    expect(rewrittenHtml).toContain("/local.jpg");
    expect(rewrittenHtml).toContain("data:image/png;base64,AAAA");
    expect(usedIds.size).toBe(2);
    expect(missedIds.size).toBe(0);
    // src(A) + srcset[B,A] + src(B) + style(A) = 5
    expect(rewriteCount).toBe(5);
  });
});
