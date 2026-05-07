import { describe, expect, it } from "vitest";

import { checkBlogStylingCalibrated } from "@/lib/site-preflight";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// Spec 03 §2.6 — checkBlogStylingCalibrated.
//
// Mode + content_type matrix:
//   - copy_existing + post + no blog_styling      → blocker fires
//   - copy_existing + post + blog_styling present → no blocker
//   - copy_existing + page                        → no blocker
//   - new_design + post                           → no blocker
//   - site_mode null + post                       → no blocker

async function setMode(
  siteId: string,
  mode: "copy_existing" | "new_design" | null,
): Promise<void> {
  const svc = getServiceRoleClient();
  await svc.from("sites").update({ site_mode: mode }).eq("id", siteId);
}

async function setExtractedDesign(
  siteId: string,
  extractedDesign: unknown,
): Promise<void> {
  const svc = getServiceRoleClient();
  await svc
    .from("sites")
    .update({ extracted_design: extractedDesign })
    .eq("id", siteId);
}

const STUB_DESIGN_NO_BLOG = {
  colors: {
    primary: "#000",
    secondary: "#111",
    accent: "#222",
    background: "#fff",
    text: "#000",
  },
  fonts: { heading: "Inter", body: "Inter" },
  layout_density: "medium",
  visual_tone: "Neutral",
  screenshot_url: null,
  source_pages: ["https://example.com"],
};

const STUB_DESIGN_WITH_BLOG = {
  ...STUB_DESIGN_NO_BLOG,
  blog_styling: {
    source_blog_urls: ["https://example.com/blog/p1"],
    article_container: "entry",
    paragraph: "entry-content",
    link_in_body: null,
    blockquote: null,
    unordered_list: null,
    ordered_list: null,
    list_item: null,
    figure: null,
    figcaption: null,
    code_inline: null,
    code_block: null,
    hr: null,
    article_h2: null,
    article_h3: null,
    article_h4: null,
    notes: [],
    extracted_at: new Date().toISOString(),
  },
};

describe("checkBlogStylingCalibrated", () => {
  it("fires for copy_existing + post + no blog_styling", async () => {
    const { id } = await seedSite();
    await setMode(id, "copy_existing");
    await setExtractedDesign(id, STUB_DESIGN_NO_BLOG);

    const result = await checkBlogStylingCalibrated(id, "post");
    expect(result).not.toBeNull();
    expect(result?.code).toBe("BLOG_STYLE_NOT_CALIBRATED");
    expect(result?.actionHref).toBe(
      `/admin/sites/${id}/setup/extract?focus=blog-styling`,
    );
  });

  it("does not fire for copy_existing + post + populated blog_styling", async () => {
    const { id } = await seedSite();
    await setMode(id, "copy_existing");
    await setExtractedDesign(id, STUB_DESIGN_WITH_BLOG);

    const result = await checkBlogStylingCalibrated(id, "post");
    expect(result).toBeNull();
  });

  it("does not fire for copy_existing + page (any blog_styling state)", async () => {
    const { id } = await seedSite();
    await setMode(id, "copy_existing");
    await setExtractedDesign(id, STUB_DESIGN_NO_BLOG);

    const result = await checkBlogStylingCalibrated(id, "page");
    expect(result).toBeNull();
  });

  it("does not fire for new_design + post", async () => {
    const { id } = await seedSite();
    await setMode(id, "new_design");
    await setExtractedDesign(id, STUB_DESIGN_NO_BLOG);

    const result = await checkBlogStylingCalibrated(id, "post");
    expect(result).toBeNull();
  });

  it("does not fire when site_mode is null (onboarding banner owns that state)", async () => {
    const { id } = await seedSite();
    await setMode(id, null);

    const result = await checkBlogStylingCalibrated(id, "post");
    expect(result).toBeNull();
  });

  it("fires when blog_styling is present but source_blog_urls is empty", async () => {
    const { id } = await seedSite();
    await setMode(id, "copy_existing");
    await setExtractedDesign(id, {
      ...STUB_DESIGN_WITH_BLOG,
      blog_styling: {
        ...STUB_DESIGN_WITH_BLOG.blog_styling,
        source_blog_urls: [],
      },
    });

    const result = await checkBlogStylingCalibrated(id, "post");
    expect(result).not.toBeNull();
    expect(result?.code).toBe("BLOG_STYLE_NOT_CALIBRATED");
  });
});
