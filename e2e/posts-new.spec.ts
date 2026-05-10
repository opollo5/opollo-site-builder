import { expect, test } from "@playwright/test";

import { auditA11y, signInAsAdmin } from "./helpers";

// BL-1 — /admin/posts/[siteId]/new entry point (rail-based site selection).
//
// Scope:
//   1. Sidebar nav links to /admin/posts.
//   2. /admin/posts redirects or shows empty state.
//   3. /admin/posts/[siteId]/new renders the composer + mode tabs directly.
//   4. Autosave persists across reload at the same URL.

// Helper: navigate to /admin/sites, click E2E Test Site, return its UUID.
async function getE2eSiteId(page: Parameters<typeof signInAsAdmin>[0]): Promise<string> {
  await page.goto("/admin/sites");
  await page.getByRole("link", { name: "E2E Test Site" }).first().click();
  await page.waitForURL(/\/admin\/sites\/[0-9a-f-]{36}$/);
  const match = /\/admin\/sites\/([0-9a-f-]{36})$/.exec(page.url());
  if (!match?.[1]) throw new Error("Could not extract E2E site ID from URL");
  return match[1];
}

test.describe("/admin/posts — Blog section entry point", () => {
  test("sidebar nav links to the blog section", async ({ page }, testInfo) => {
    await signInAsAdmin(page);

    const navLink = page.getByTestId("nav-post-blog").first();
    await expect(navLink).toBeVisible();
    await navLink.click();

    // Either lands on the empty state (/admin/posts) or auto-redirects to
    // /admin/posts/[siteId]/new if exactly one site exists in the seed.
    await page.waitForURL(/\/admin\/posts/);

    // In either case the Blog section nav appears.
    await expect(page.getByTestId("section-nav-title")).toHaveText("Blog");

    await auditA11y(page, testInfo);
  });

  test("/admin/posts/new 308-redirects to /admin/posts", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/posts/new");
    await page.waitForURL(/\/admin\/posts/);
    // Must not have landed back at /admin/posts/new.
    expect(page.url()).not.toMatch(/\/admin\/posts\/new$/);
  });
});

test.describe("/admin/posts/[siteId]/new — site-scoped composer", () => {
  test("renders tabs + composer immediately (no page-level site picker)", async ({
    page,
  }, testInfo) => {
    await signInAsAdmin(page);
    const siteId = await getE2eSiteId(page);
    await page.goto(`/admin/posts/${siteId}/new`);

    // Mode tabs present immediately — no gating behind a page picker.
    await expect(page.getByRole("tab", { name: /single post/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /bulk upload/i })).toBeVisible();

    // Composer (TipTap ProseMirror) visible without any further action.
    await expect(page.locator(".ProseMirror")).toBeVisible();

    // Old page-level site picker must NOT exist.
    await expect(page.getByTestId("posts-new-site-picker")).toHaveCount(0);

    await auditA11y(page, testInfo);
  });

  test("bulk-upload tab renders the dropzone", async ({ page }, testInfo) => {
    await signInAsAdmin(page);
    const siteId = await getE2eSiteId(page);
    await page.goto(`/admin/posts/${siteId}/new`);

    await page.getByTestId("posts-new-tab-bulk").click();

    await expect(page.getByTestId("bulk-dropzone")).toBeVisible();
    await expect(page.getByTestId("bulk-paste-textarea")).toBeVisible();

    await page.getByTestId("bulk-paste-textarea").fill(
      ["---", "title: First", "---", "Body of first.", "---", "title: Second", "---", "Body of second."].join("\n"),
    );
    await expect(page.getByTestId("bulk-summary")).toContainText(/2 posts? ready/i);

    await auditA11y(page, testInfo);
  });

  // BL-2 autosave + draft-restore banner round-trip.
  test("autosave persists across reload; draft-restore banner lets operator restore or discard", async ({
    page,
  }, testInfo) => {
    await signInAsAdmin(page);
    const siteId = await getE2eSiteId(page);
    await page.goto(`/admin/posts/${siteId}/new`);

    await expect(page.getByTestId("post-sidebar")).toBeVisible();
    await expect(page.getByTestId("sidebar-publish")).toBeVisible();
    await expect(page.getByTestId("seo-section")).toBeVisible();
    await expect(page.locator("#post-slug")).toBeVisible();

    const composer = page.locator(".ProseMirror");
    await composer.click();
    await composer.pressSequentially("Hello world body for autosave probe.");
    await page.locator("#post-title").fill("Autosave probe");

    await expect(page.getByTestId("post-save-status")).toContainText(/saved/i, { timeout: 8000 });

    // Reload at the same URL — composer remounts for the same siteId.
    await page.reload();
    await page.waitForURL(/\/admin\/posts\/[0-9a-f-]{36}\/new$/);

    // The draft-restore banner (from BlogPostComposer) surfaces.
    await expect(page.getByTestId("draft-restore-banner")).toBeVisible();
    await expect(page.locator("#post-title")).toHaveValue("");

    await page.getByTestId("draft-restore-button").click();
    await expect(page.getByTestId("draft-restore-banner")).toHaveCount(0);
    await expect(page.locator("#post-title")).toHaveValue(/autosave probe/i);
    await expect(page.locator(".ProseMirror")).toContainText(/hello world body for autosave probe/i);

    await auditA11y(page, testInfo);
  });

  test("draft-restore banner discard clears the stored draft", async ({
    page,
  }, testInfo) => {
    await signInAsAdmin(page);
    const siteId = await getE2eSiteId(page);
    await page.goto(`/admin/posts/${siteId}/new`);

    const composer = page.locator(".ProseMirror");
    await composer.click();
    await composer.pressSequentially("Draft to be discarded.");
    await page.locator("#post-title").fill("Discard me");

    await expect(page.getByTestId("post-save-status")).toContainText(/saved/i, { timeout: 8000 });

    await page.reload();
    await expect(page.getByTestId("draft-restore-banner")).toBeVisible();

    await page.getByTestId("draft-discard-button").click();
    await expect(page.getByTestId("draft-restore-banner")).toHaveCount(0);
    await expect(page.locator("#post-title")).toHaveValue("");

    await auditA11y(page, testInfo);
  });

  test("sidebar panels are visible and collapsible", async ({ page }, testInfo) => {
    await signInAsAdmin(page);
    const siteId = await getE2eSiteId(page);
    await page.goto(`/admin/posts/${siteId}/new`);

    const publishPanel = page.getByTestId("sidebar-publish");
    const seoSection = page.getByTestId("seo-section");
    const categoriesPanel = page.getByTestId("sidebar-categories");
    const tagsPanel = page.getByTestId("sidebar-tags");
    const featuredImagePanel = page.getByTestId("sidebar-featured-image");

    await expect(publishPanel).toBeVisible();
    await expect(seoSection).toBeVisible();
    await expect(seoSection.locator("#post-slug")).toBeVisible();
    await expect(categoriesPanel).toBeVisible();
    await expect(tagsPanel).toBeVisible();
    await expect(featuredImagePanel).toBeVisible();

    await expect(publishPanel.getByRole("button", { name: /save as draft/i })).toBeVisible();
    await expect(publishPanel.getByRole("button", { name: /^save draft$/i })).toHaveCount(0);

    await publishPanel.getByRole("radio", { name: /publish immediately/i }).click();
    await expect(publishPanel.getByRole("button", { name: /^save draft$/i })).toBeVisible();
    await publishPanel.getByRole("radio", { name: /save as draft/i }).click();
    await expect(publishPanel.getByRole("button", { name: /^save draft$/i })).toHaveCount(0);

    await publishPanel.getByRole("button", { name: /^publish$/i }).click();
    await expect(publishPanel.getByRole("button", { name: /save as draft/i })).toHaveCount(0);

    await publishPanel.getByRole("button", { name: /^publish$/i }).click();
    await expect(publishPanel.getByRole("button", { name: /save as draft/i })).toBeVisible();

    await expect(seoSection.locator("#post-meta-title")).toBeVisible();
    await expect(seoSection.locator("#post-meta-description")).toBeVisible();

    const visibilityPanel = page.getByTestId("sidebar-visibility");
    await expect(visibilityPanel).toBeVisible();

    await auditA11y(page, testInfo);
  });
});
