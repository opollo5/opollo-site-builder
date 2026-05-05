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

  // BL-2 — new post route always starts blank; saved draft is offered
  // via an explicit restore banner, never silently applied.
  test("navigating to new post always starts with empty editor", async ({
    page,
  }, testInfo) => {
    await signInAsAdmin(page);
    await page.goto("/admin/posts/new");

    await page.getByTestId("posts-new-site-picker").click();
    const firstOption = page
      .locator('[data-testid^="posts-new-site-option-"]')
      .first();
    await firstOption.click();

    // Seed a draft in localStorage so the next navigation would previously
    // have silently restored it.
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) =>
        k.startsWith("opollo:post-draft:"),
      );
      if (!key) {
        // Write a synthetic stale draft so the test is deterministic even
        // when no prior autosave exists.
        const siteId = window.location.search; // fallback — not ideal but robust
        void siteId;
        // Write to any matching key; the composerValue is what we care about.
        const entries = Object.entries(localStorage);
        const draftKey =
          entries.find(([k]) => k.startsWith("opollo:post-draft:"))?.[0] ??
          "opollo:post-draft:synthetic";
        localStorage.setItem(
          draftKey,
          JSON.stringify({
            v: 1,
            composerText: "<p>Stale content from previous session</p>",
            title: { value: "Stale title", source: "h1", touched: true },
            slug: { value: "url1", source: "derived", touched: true },
            savedAt: Date.now() - 1000 * 60 * 60, // 1 hour ago
          }),
        );
      }
    });

    await page.reload();
    await page.getByTestId("posts-new-site-picker").click();
    await page
      .locator('[data-testid^="posts-new-site-option-"]')
      .first()
      .click();

    // The editor must be blank — no stale content.
    await expect(page.locator(".ProseMirror")).toBeEmpty();
    // Title field must be blank.
    await expect(page.locator("#post-title")).toHaveValue("");

    // A restore banner must be visible, offering to bring the draft back.
    await expect(page.getByTestId("draft-restore-banner")).toBeVisible();
    await expect(page.getByTestId("draft-restore-btn")).toBeVisible();
    await expect(page.getByTestId("draft-discard-btn")).toBeVisible();

    await auditA11y(page, testInfo);
  });

  // BL-2 — autosave + explicit restore round-trip.
  test("clicking Restore draft applies saved content", async ({
    page,
  }, testInfo) => {
    await signInAsAdmin(page);
    await page.goto("/admin/posts/new");

    await page.getByTestId("posts-new-site-picker").click();
    const firstOption = page
      .locator('[data-testid^="posts-new-site-option-"]')
      .first();
    await firstOption.click();

    const composer = page.locator(".ProseMirror");
    await composer.click();
    await composer.pressSequentially("Hello world body for autosave probe.");
    await page.locator("#post-title").fill("Autosave probe");

    await expect(page.getByTestId("post-save-status")).toContainText(
      /saved ·/i,
      { timeout: 8000 },
    );

    await page.reload();

    await page.getByTestId("posts-new-site-picker").click();
    await page
      .locator('[data-testid^="posts-new-site-option-"]')
      .first()
      .click();

    // Restore banner visible; editor still blank.
    await expect(page.getByTestId("draft-restore-banner")).toBeVisible();
    await expect(page.locator("#post-title")).toHaveValue("");

    // Click Restore — draft content loads.
    await page.getByTestId("draft-restore-btn").click();
    await expect(page.locator("#post-title")).toHaveValue(/autosave probe/i);
    await expect(page.locator(".ProseMirror")).toContainText(
      /hello world body for autosave probe/i,
    );

    // Banner disappears after restoring.
    await expect(page.getByTestId("draft-restore-banner")).toHaveCount(0);

    await auditA11y(page, testInfo);
  });

  // BL-2 — dismissing the banner clears the saved draft.
  test("clicking Start fresh clears the saved draft and hides banner", async ({
    page,
  }, testInfo) => {
    await signInAsAdmin(page);
    await page.goto("/admin/posts/new");

    await page.getByTestId("posts-new-site-picker").click();
    const firstOption = page
      .locator('[data-testid^="posts-new-site-option-"]')
      .first();
    await firstOption.click();

    const composer = page.locator(".ProseMirror");
    await composer.click();
    await composer.pressSequentially("Some content to be discarded.");
    await page.locator("#post-title").fill("Draft to discard");

    await expect(page.getByTestId("post-save-status")).toContainText(
      /saved ·/i,
      { timeout: 8000 },
    );

    await page.reload();

    await page.getByTestId("posts-new-site-picker").click();
    await page
      .locator('[data-testid^="posts-new-site-option-"]')
      .first()
      .click();

    await expect(page.getByTestId("draft-restore-banner")).toBeVisible();

    // Click Start fresh — banner disappears, editor stays blank.
    await page.getByTestId("draft-discard-btn").click();
    await expect(page.getByTestId("draft-restore-banner")).toHaveCount(0);
    await expect(page.locator("#post-title")).toHaveValue("");
    await expect(page.locator(".ProseMirror")).toBeEmpty();

    await auditA11y(page, testInfo);
  });
});
