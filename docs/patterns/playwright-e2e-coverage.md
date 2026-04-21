# Pattern — Playwright E2E coverage

## When to use it

Any PR that adds or substantially changes an admin-facing route, form, or server action. `CLAUDE.md` codifies this as a hard requirement; this pattern file is the *how*.

Rule of thumb:

- **New page** → new spec OR new test in the closest topical file (`sites` / `users` / `batches` / `auth`).
- **New form / modal** → at least one test that opens, submits, asserts the after-state.
- **New API mutation with a UI surface** → covered by the UI spec that drives it. The API itself is covered at the unit layer.

Don't use for: pure `lib/` changes (unit tests are enough), flagged-off surfaces (state why in the PR description and land the E2E when the flag flips), truly headless background jobs (unit tests + concurrency harness).

## Required files

| File | Role |
| --- | --- |
| `e2e/<topic>.spec.ts` | One spec file per admin area. `sites.spec.ts`, `users.spec.ts`, `batches.spec.ts`, `auth.spec.ts`. New admin areas get new files. |
| `e2e/helpers.ts` | `signInAsAdmin`, `auditA11y`. Extend, don't duplicate. |
| `e2e/fixtures.ts` | `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`, other seed constants. |
| `e2e/global-setup.ts` | Seeds the admin user + baseline data via Supabase admin API. Idempotent. |
| `playwright.config.ts` | One-time config. Don't touch per-PR unless you're changing the harness. |
| `.github/workflows/e2e.yml` | CI wire-up. One-time. |

## Scaffolding

### Per-spec structure

Model on `e2e/sites.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

import { auditA11y, signInAsAdmin } from "./helpers";

test.describe("<resource> CRUD", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("list renders + row click lands on detail", async ({ page }, testInfo) => {
    await page.goto("/admin/<resource>");
    await auditA11y(page, testInfo);
    await expect(page.getByRole("heading", { name: "Manage <resource>" })).toBeVisible();

    // Seeded row from global-setup.
    const row = page.getByRole("row", { name: /<seed-name>/i });
    await expect(row).toBeVisible();

    await row.getByRole("link", { name: "<seed-name>" }).click();
    await page.waitForURL(/\/admin\/<resource>\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "<seed-name>" })).toBeVisible();
  });

  test("create flow", async ({ page }) => {
    await page.goto("/admin/<resource>");
    await page.getByRole("button", { name: /add new <resource>/i }).click();

    const uniqueName = `Playwright Temp ${Date.now()}`;
    await page.getByLabel("Name").fill(uniqueName);
    // ... fill remaining fields
    await page.getByRole("button", { name: /register <resource>/i }).click();

    // Modal closes on success; new row appears after revalidatePath.
    await expect(page.getByText(uniqueName).first()).toBeVisible();
  });

  test("archive flow removes row from default list", async ({ page }) => {
    await page.goto("/admin/<resource>");

    // Seed a disposable row from the UI — don't share the global seed.
    const disposable = `Archive Target ${Date.now()}`;
    // ... create via the modal ...

    const row = page.getByRole("row", { name: new RegExp(disposable) });
    await row.getByRole("button", { name: /actions for/i }).click();

    // Browser confirm() auto-accept.
    page.once("dialog", (dialog) => { void dialog.accept(); });
    await row.getByRole("button", { name: /^archive$/i }).click();

    await expect(page.getByRole("row", { name: new RegExp(disposable) })).toHaveCount(0);
  });
});
```

Key rules:

- **`signInAsAdmin` in `beforeEach`.** Exercises the real login form — the point of E2E is to test what a browser actually does, not to hit auth endpoints directly.
- **`auditA11y(page, testInfo)` on every page you navigate to.** Non-blocking today; findings attach to the test as an artifact so the roadmap to Level-3 blocking runs builds history.
- **Use role-based locators.** `getByRole("row", { name: ... })`, `getByLabel("Name")`. Fragile CSS selectors (`.sites-table-row`) break on refactors.
- **`Date.now()` in names** of test-created rows. Prevents accidental collision across concurrent CI runs hitting the same Supabase stack.
- **Don't mutate the global seed.** `global-setup.ts` creates the shared "E2E Test Site" that multiple tests read. Create + destroy disposable rows inside tests for any write flow.

### The handful of Playwright idioms that keep biting

**Browser confirm() auto-accept.** The standard archive flow calls `window.confirm("Are you sure?")` on the client. Intercept before the click:

```ts
page.once("dialog", (dialog) => { void dialog.accept(); });
await row.getByRole("button", { name: /^archive$/i }).click();
```

`once` not `on` — otherwise every subsequent dialog in the test auto-accepts.

**Waiting for navigation after a form submit.** `await page.waitForURL(/\/admin\/<route>/)` after a Server Action that redirects. If the form doesn't redirect, assert the after-state on the current page.

**Waiting for a server-revalidated list.** After create / archive, the server component re-renders. `await expect(page.getByText(...)).toBeVisible()` waits for the text to appear; no explicit sleep needed.

**Modal text vs page text.** When the modal title is the same string as the page heading, `getByText(...)` matches both. Use `getByRole("heading", ...)` or scope to a specific region.

### global-setup.ts

Model on `e2e/global-setup.ts`:

- Seeds a single admin user (`E2E_ADMIN_EMAIL`) via Supabase admin API. Idempotent: checks if the user exists before creating.
- Promotes them to `role='admin'` in `opollo_users`.
- Seeds one canonical site the specs can read ("E2E Test Site"), also idempotent.
- Runs once per test run, not once per spec.

Seeds live in `global-setup.ts`, NOT in each spec's `beforeAll`. Otherwise every spec does its own auth-user setup and parallel specs collide.

## Required tests per new admin surface

Minimum per new page:

1. **List renders.** Heading visible, seeded row visible, `auditA11y` runs.
2. **Row click → detail.** Clicking the row's link lands on `/admin/<resource>/<uuid>`.
3. **Create flow.** Modal opens, form fills, submit, new row appears.
4. **Edit flow** (if the page has edit). Open edit modal, change a field, submit, change is reflected.
5. **Archive / delete flow.** Row disappears from the default list after the action.
6. **Error surface.** At least one negative test — e.g. submitting with a missing required field shows the validation error.

Specs can grow beyond six tests; the floor is "every user-visible outcome has one test."

## Standard PR structure

Follow [`ship-sub-slice.md`](./ship-sub-slice.md). Title: usually `feat(admin/<resource>): …` for new surfaces; `feat(e2e): …` for purely test additions.

If a PR changes UI without adding the corresponding E2E, the description MUST state why:

- "Purely a lib/ change, no admin-UI surface."
- "Admin-facing but flagged off for this slice; E2E lands in the flag-flip PR."
- "Refactor of existing behaviour already covered by <existing-spec>."

Silent omissions are a review blocker.

## Known pitfalls

- **Axe `critical` severity not blocking.** Today they attach findings as artifacts; they don't fail the suite. Target state is Level-3 blocking; don't ship a new axe violation and flag it "known." Fix it or document the triage plan.
- **`getByText` matching partial.** `getByText("Users")` matches both the heading and any row with "Users" in the name. Use `getByRole("heading", { name: "Users" })`.
- **Overly specific locators.** `page.locator("table.sites-table > tbody > tr:nth-child(2)")` breaks on any table-component refactor. Role-based locators survive.
- **Test seeds sharing names across files.** `batches.spec.ts` and `sites.spec.ts` both creating a row called `"Playwright Temp"` — one test's archive sweep takes out the other. Append `Date.now()` + file-specific prefix.
- **Modal close not awaited.** `click("cancel")` → immediate `expect(input).not.toBeVisible()` can race the animation. Use `await expect(modal).not.toBeVisible()` instead of asserting on children.
- **Global-setup mutations not idempotent.** Running the full suite twice locally should leave Supabase in the same state as one run. If it accumulates rows, the seed is wrong.
- **`FEATURE_SUPABASE_AUTH` unset in CI.** The E2E workflow force-sets `FEATURE_SUPABASE_AUTH=true` so the real login flow runs. Local `npm run test:e2e` uses `playwright.config.ts` to match.
- **Flake from Supabase startup timing in CI.** `supabase start` sometimes takes 20–30s. The workflow does reads via `supabase status --output json | jq -r '.API_URL'` right after start; if status returns early, env vars are empty. The workflow pattern in `e2e.yml` handles this; don't short-cut.
- **Snapshot / visual regression not yet wired.** `toHaveScreenshot()` is deferred — baselines must be captured in the exact CI image first, reviewed, and committed. `docs/testing-roadmap.md` has the Level-2 plan.

## Pointers

- Canonical instances: `e2e/auth.spec.ts`, `e2e/sites.spec.ts`, `e2e/users.spec.ts`, `e2e/batches.spec.ts`.
- Helpers: `e2e/helpers.ts`, `e2e/global-setup.ts`, `e2e/fixtures.ts`.
- Config: `playwright.config.ts`, `.github/workflows/e2e.yml`.
- Roadmap: `docs/testing-roadmap.md` (Level 2–7 plan; Level 1 shipped).
- Related: [`new-admin-page.md`](./new-admin-page.md) (E2E is part of the admin-page pattern).
