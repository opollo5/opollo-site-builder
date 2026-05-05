import { expect, test } from "@playwright/test";

import { auditA11y, signInAsAdmin } from "./helpers";

// BL-1 — Top-level /admin/posts/new entry point.
//
// Scope:
//   1. Sidebar nav has a "Post a blog" entry.
//   2. /admin/posts/new renders with the site picker + tab row.
//   3. The composer is gated until a site is picked; picking a site
//      reveals it.
//   4. The Bulk-upload tab shows its placeholder shell (BL-5 fills it).

test.describe("/admin/posts/new — top-level entry", () => {
  test("sidebar nav links to the route and the page renders", async ({
    page,
  }, testInfo) => {
    await signInAsAdmin(page);

    // Nav entry exists and is reachable.
    const navLink = page.getByTestId("nav-post-blog").first();
    await expect(navLink).toBeVisible();
    await navLink.click();
    await page.waitForURL(/\/admin\/posts\/new$/);

    // Tabs row + site picker present before any composer is rendered.
    await expect(
      page.getByRole("tab", { name: /single post/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: /bulk upload/i }),
    ).toBeVisible();
    await expect(page.getByTestId("posts-new-site-picker")).toBeVisible();

    // Composer is gated — the empty-state copy fronts the surface.
    await expect(
      page.getByText(/pick a site to start drafting/i),
    ).toBeVisible();

    await auditA11y(page, testInfo);
  });

  test("picking a site reveals the composer", async ({ page }, testInfo) => {
    await signInAsAdmin(page);
    await page.goto("/admin/posts/new");

    await page.getByTestId("posts-new-site-picker").click();
    // The seed contains at least one site (the E2E test site).
    const firstOption = page
      .locator('[data-testid^="posts-new-site-option-"]')
      .first();
    await expect(firstOption).toBeVisible();
    await firstOption.click();

    // Composer (TipTap ProseMirror) appears once a site is bound.
    await expect(page.locator(".ProseMirror")).toBeVisible();

    await auditA11y(page, testInfo);
  });

  test("bulk-upload tab renders the dropzone after a site is picked", async ({
    page,
  }, testInfo) => {
    await signInAsAdmin(page);
    await page.goto("/admin/posts/new");

    // Pre-pick is required — bulk panel needs a siteId.
    await page.getByTestId("posts-new-site-picker").click();
    await page
      .locator('[data-testid^="posts-new-site-option-"]')
      .first()
      .click();

    await page.getByTestId("posts-new-tab-bulk").click();

    await expect(page.getByTestId("bulk-dropzone")).toBeVisible();
    await expect(page.getByTestId("bulk-paste-textarea")).toBeVisible();

    // Paste a stacked-YAML blob and confirm the count surfaces.
    await page.getByTestId("bulk-paste-textarea").fill(
      [
        "---",
        "title: First",
        "---",
        "Body of first.",
        "---",
        "title: Second",
        "---",
        "Body of second.",
      ].join("\n"),
    );
    await expect(page.getByTestId("bulk-summary")).toContainText(
      /2 posts? ready/i,
    );

    await auditA11y(page, testInfo);
  });

  // BL-2 — autosave + progressive disclosure round-trip.
  test("autosave persists across reload and disclosure toggles", async ({
    page,
  }, testInfo) => {
    await signInAsAdmin(page);
    await page.goto("/admin/posts/new");

    // Pick the seeded site so the composer mounts with a stable
    // localStorage key.
    await page.getByTestId("posts-new-site-picker").click();
    const firstOption = page
      .locator('[data-testid^="posts-new-site-option-"]')
      .first();
    await firstOption.click();

    // Advanced fields are collapsed by default for a fresh draft.
    const panel = page.getByTestId("post-advanced-panel");
    await expect(panel).toHaveCount(0);

    // Type into the composer (TipTap ProseMirror). Use pressSequentially so
    // TipTap's key-event handlers fire and update the React state that the
    // autosave debounce watches.
    const composer = page.locator(".ProseMirror");
    await composer.click();
    await composer.pressSequentially("Hello world body for autosave probe.");
    await page.locator("#post-title").fill("Autosave probe");

    // Wait for the autosave to COMPLETE (localStorage written), not just
    // started. "Saving…" fires immediately; "Saved ·" fires after the 800ms
    // debounce callback runs.
    await expect(page.getByTestId("post-save-status")).toContainText(
      /saved ·/i,
      { timeout: 8000 },
    );

    // Open the disclosure manually.
    await page.getByTestId("post-advanced-toggle").click();
    await expect(page.getByTestId("post-advanced-panel")).toBeVisible();

    // Reload — the snapshot should rehydrate the title + body.
    await page.reload();

    // The site picker resets to "Pick a site…" because the page
    // tracks selection client-side, but the composer's localStorage
    // is keyed by siteId. Re-pick the site to remount the composer.
    await page.getByTestId("posts-new-site-picker").click();
    await page
      .locator('[data-testid^="posts-new-site-option-"]')
      .first()
      .click();

    await expect(page.locator("#post-title")).toHaveValue(
      /autosave probe/i,
    );
    await expect(page.locator(".ProseMirror")).toContainText(
      /hello world body for autosave probe/i,
    );

    // "Draft restored" status surfaces with a Discard control.
    await expect(page.getByTestId("post-save-status")).toContainText(
      /draft restored|saved/i,
    );

    await auditA11y(page, testInfo);
  });

  // Fix 4 — "Publishing to" Change link must navigate to /admin/posts/new
  // (the site picker), not to the site settings brand-voice page.
  test("'Publishing to' Change link returns to /admin/posts/new", async ({
    page,
  }, testInfo) => {
    await signInAsAdmin(page);
    await page.goto("/admin/posts/new");

    await page.getByTestId("posts-new-site-picker").click();
    await page
      .locator('[data-testid^="posts-new-site-option-"]')
      .first()
      .click();

    // Wait for the composer to mount.
    await expect(page.locator(".ProseMirror")).toBeVisible();

    // The "Publishing to" section is only rendered when the site has WP
    // credentials set (siteWpUrl is non-null). Check both cases.
    const changeLink = page.getByRole("link", { name: /^change$/i });

    if (await changeLink.isVisible()) {
      // The link must point to the site picker route, NOT to settings.
      const href = await changeLink.getAttribute("href");
      expect(href).toBe("/admin/posts/new");
      expect(href).not.toMatch(/\/settings/);
    }

    // Regardless of WP credentials, no link on this page should route to
    // site-level settings from the "Publishing to" indicator.
    const settingsLinks = page.locator(
      `[href*="/admin/sites/"][href$="/settings"]`,
    );
    // The only acceptable settings link is the "Connect a site" fallback,
    // which is only shown when the site has NO WP credentials.
    const wpConnected = await page
      .getByText("Publishing to:", { exact: false })
      .isVisible();
    if (wpConnected) {
      await expect(settingsLinks).toHaveCount(0);
    }

    await auditA11y(page, testInfo);
  });
});
