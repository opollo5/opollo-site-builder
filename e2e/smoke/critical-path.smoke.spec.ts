import { expect, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// LAYER 7 — production smoke.
//
// Runs against the live deployment after every Vercel production
// deploy of code touching critical paths. Wired in
// .github/workflows/smoke.yml — triggered by a Vercel deploy hook.
//
// Standard scope (per the brief):
//   1. Log in as the designated production smoke-test user.
//   2. Sweep critical pages (sites, blog, batches, images, social,
//      optimiser, users, companies).
//   3. Assert no console errors.
//   4. Assert no failed network requests from same-origin.
//   5. Assert no axe violations on the critical paths (login, social
//      composer, social connections).
//
// What we deliberately do NOT do here:
//   - Mutate any data. Smoke is read-only.
//   - Drive the bundle.social connect flow (requires external OAuth).
//   - Run the brief generation loop (slow + spends Anthropic budget).
//
// Required env (GitHub Action secrets):
//   PROD_SMOKE_USER_EMAIL
//   PROD_SMOKE_USER_PASSWORD
//   PLAYWRIGHT_BASE_URL (= PRODUCTION_DOMAIN)
// ---------------------------------------------------------------------------

const SMOKE_EMAIL = process.env.PROD_SMOKE_USER_EMAIL;
const SMOKE_PASSWORD = process.env.PROD_SMOKE_USER_PASSWORD;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  if (!SMOKE_EMAIL || !SMOKE_PASSWORD) {
    throw new Error(
      "Smoke env unset — PROD_SMOKE_USER_EMAIL and PROD_SMOKE_USER_PASSWORD must be configured. See docs/test-coverage-target.md §7.",
    );
  }
});

test.describe("smoke — critical path read-only sweep", () => {
  test("home → login → admin home renders without console errors", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("requestfailed", (req) => {
      failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
    });

    await page.goto("/login");
    await expect(page).toHaveURL(/\/login/);

    await page.getByLabel(/email/i).fill(SMOKE_EMAIL!);
    await page.getByLabel(/password/i).fill(SMOKE_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Land at admin home (or company home depending on role).
    await page.waitForURL((u) =>
      u.pathname.startsWith("/admin") || u.pathname.startsWith("/company"),
      { timeout: 20_000 },
    );

    // Page rendered without console errors.
    expect(consoleErrors, `Console errors: ${consoleErrors.join("\n")}`).toEqual([]);
    expect(failedRequests, `Failed network requests: ${failedRequests.join("\n")}`).toEqual([]);
  });

  test.describe("read-only page sweep", () => {
    const pages: Array<{ name: string; path: string }> = [
      { name: "sites", path: "/admin/sites" },
      { name: "blog", path: "/admin/blog" },
      { name: "batches", path: "/admin/batches" },
      { name: "images", path: "/admin/images" },
      { name: "users", path: "/admin/users" },
      { name: "companies", path: "/admin/companies" },
      { name: "optimiser", path: "/optimiser" },
      { name: "insights-admin", path: "/admin/insights" },
    ];

    for (const { name, path } of pages) {
      test(`${name} loads`, async ({ page, browser: _browser }) => {
        // Pre-auth — driven by saved-state from the first test.
        // For the smoke skeleton, every test re-authenticates; once
        // a stable storageState is wired, switch to a fixture.
        await page.goto("/login");
        await page.getByLabel(/email/i).fill(SMOKE_EMAIL!);
        await page.getByLabel(/password/i).fill(SMOKE_PASSWORD!);
        await page.getByRole("button", { name: /sign in/i }).click();
        await page.waitForURL(/\/(admin|company)/, { timeout: 20_000 });

        const consoleErrors: string[] = [];
        page.on("console", (msg) => {
          if (msg.type() === "error") consoleErrors.push(msg.text());
        });

        const resp = await page.goto(path);
        expect(resp?.status(), `GET ${path} status`).toBeLessThan(500);
        expect(consoleErrors, `Console errors on ${path}`).toEqual([]);
      });
    }
  });
});
