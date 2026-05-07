import { describe, expect, it } from "vitest";

import { renderInjection } from "@/lib/design-discovery/build-injection";

// Spec 03 §3.3 — <blog_content_classes> emission rules.
//
// The renderInjection() helper is exercised here directly with stub
// SiteContextRow inputs so we don't depend on the Supabase stack for
// pure-function behaviour. The DB-loading path is exercised via the
// existing brief-runner-dummy integration test footprint (locate +
// extend in a follow-up if/when the runner-side activation lands;
// see docs/specs/_blockers.md).

const BLOG_STYLING_FULL = {
  source_blog_urls: ["https://example.com/blog/p1"],
  article_container: "entry",
  paragraph: "entry-content",
  link_in_body: "entry-link",
  blockquote: null,
  unordered_list: null,
  ordered_list: null,
  list_item: null,
  figure: null,
  figcaption: null,
  code_inline: null,
  code_block: null,
  hr: null,
  article_h2: "wp-block-heading",
  article_h3: null,
  article_h4: null,
  notes: [],
  extracted_at: new Date().toISOString(),
};

function copyExistingRow(opts: {
  blog_styling?: unknown;
}): Parameters<typeof renderInjection>[0] {
  return {
    site_mode: "copy_existing",
    design_direction_status: null,
    tone_of_voice_status: null,
    design_tokens: null,
    homepage_concept_html: null,
    tone_applied_homepage_html: null,
    tone_of_voice: null,
    extracted_design: {
      colors: { primary: "#000" },
      fonts: { heading: "Inter" },
      layout_density: "medium",
      visual_tone: "Neutral",
      blog_styling: opts.blog_styling ?? null,
    } as unknown as Record<string, unknown>,
    extracted_css_classes: {
      container: "container",
      headings: { h1: "h1", h2: "h2", h3: "h3" },
      button: "btn",
      card: "card",
    } as unknown as Record<string, unknown>,
  };
}

describe("renderInjection — Spec 03 PR 3 blog_content_classes block", () => {
  it("emits the block when blog_styling is present + content_type='post'", () => {
    const out = renderInjection(
      copyExistingRow({ blog_styling: BLOG_STYLING_FULL }),
      "post",
    );
    expect(out).toContain("<blog_content_classes>");
    expect(out).toContain("paragraph: .entry-content");
    expect(out).toContain("article_h2: .wp-block-heading");
    expect(out).toContain("</blog_content_classes>");
  });

  it("does NOT emit when blog_styling is present + content_type='page'", () => {
    const out = renderInjection(
      copyExistingRow({ blog_styling: BLOG_STYLING_FULL }),
      "page",
    );
    expect(out).not.toContain("<blog_content_classes>");
    // The landing-page block always emits for copy_existing.
    expect(out).toContain("<existing_theme_context>");
  });

  it("does NOT emit when blog_styling is null + content_type='post'", () => {
    const out = renderInjection(
      copyExistingRow({ blog_styling: null }),
      "post",
    );
    expect(out).not.toContain("<blog_content_classes>");
  });

  it("does NOT emit when blog_styling is null + content_type='page'", () => {
    const out = renderInjection(
      copyExistingRow({ blog_styling: null }),
      "page",
    );
    expect(out).not.toContain("<blog_content_classes>");
  });

  it("renders the placeholder text for null buckets", () => {
    const out = renderInjection(
      copyExistingRow({
        blog_styling: { ...BLOG_STYLING_FULL, blockquote: null, code_block: null },
      }),
      "post",
    );
    // Placeholder format per spec: '(none — use plain <X>)'
    expect(out).toContain("blockquote: (none — use plain <blockquote>)");
    expect(out).toContain("code_block: (none — use plain <pre><code>)");
  });

  it("does NOT emit when blog_styling has zero source URLs and zero non-null buckets", () => {
    const out = renderInjection(
      copyExistingRow({
        blog_styling: {
          ...BLOG_STYLING_FULL,
          source_blog_urls: [],
          article_container: null,
          paragraph: null,
          link_in_body: null,
          article_h2: null,
        },
      }),
      "post",
    );
    expect(out).not.toContain("<blog_content_classes>");
  });

  it("does NOT emit when content_type is undefined (default)", () => {
    const out = renderInjection(
      copyExistingRow({ blog_styling: BLOG_STYLING_FULL }),
    );
    expect(out).not.toContain("<blog_content_classes>");
  });

  it("emits the landing-page block alongside, not instead of", () => {
    const out = renderInjection(
      copyExistingRow({ blog_styling: BLOG_STYLING_FULL }),
      "post",
    );
    // Both blocks present; <existing_theme_context> appears first.
    const idxTheme = out.indexOf("<existing_theme_context>");
    const idxBlog = out.indexOf("<blog_content_classes>");
    expect(idxTheme).toBeGreaterThan(-1);
    expect(idxBlog).toBeGreaterThan(idxTheme);
  });
});
