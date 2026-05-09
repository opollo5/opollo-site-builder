import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "./helpers";

// Spec 03 §2.7 Playwright — blog-styling gate happy path.
//
// 2026-05-09 — replaced four runtime `test.skip()` branches with a
// single declarative `test.fixme()` per the test-harness Phase D
// gap-fill rule (CLAUDE.md §"Skips and `fixme`"). The original spec
// silently skipped whenever the e2e seed didn't include a
// copy_existing site without blog_styling. CI output showed
// "passing" tests that never asserted anything — exactly the
// fake-progress mode the brief forbids.
//
// Resolution path: when the e2e seed (`e2e/global-setup.ts`) is
// extended to provision a copy_existing site that lacks blog_styling,
// the precondition will hold deterministically and this spec gets
// flipped from `test.fixme` to a real `test`. Until then, marking
// fixme makes the deferral explicit in test reports.
//
// Unit-layer coverage of the gate logic is in
// `lib/__tests__/copy-existing-extract-blog.test.ts` — that test
// already drives the same boundary, just at a different layer.

test.describe("Spec 03 — blog-styling calibration banner", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test.fixme(
    "calibration banner deep-links to wizard with section auto-expanded",
    async ({ page }) => {
      // Once the e2e seed provisions the right site shape, remove
      // `.fixme` and let this body run. Today the seed doesn't
      // guarantee a copy_existing site without blog_styling — running
      // the assertion here would intermittently fail.
      await page.goto("/admin/sites");
      const firstSiteRow = page.getByRole("link", {
        name: /E2E Test Site/i,
      });
      const siteHref = await firstSiteRow.first().getAttribute("href");
      const id = siteHref?.match(/\/admin\/sites\/([0-9a-f-]{36})/)?.[1];
      await page.goto(`/admin/sites/${id}/setup/extract?focus=blog-styling`);

      const toggle = page.getByTestId("blog-styling-toggle");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByTestId("blog-url-1")).toBeVisible();
      await expect(page.getByTestId("blog-styling-extract-run")).toBeVisible();
    },
  );
});
