import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { E2E_TEST_SITE_PREFIX } from "./fixtures";
import { auditA11y, signInAsAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// M13-5d — Appearance panel E2E.
//
// Scope:
//   1. Page renders with breadcrumbs + heading + scope-clarifier note
//   2. Initial event log surfaces seeded appearance_events
//   3. After mount, /preflight runs — assert SOMETHING resolves
//      (blocker / inactive / ready / error). The E2E test site
//      doesn't have a real Kadence-bearing WP, so we accept any
//      terminal phase except "loading" after a short wait.
//   4. auditA11y runs on the rendered page
//
// Out of scope:
//   - Confirm-modal post-action flow (needs real or mocked WP).
//     Unit-test coverage in appearance-sync-routes.test.ts hits the
//     server-side mutation logic; the modals are a thin client shell.
// ---------------------------------------------------------------------------

function supabaseServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY must be set for the E2E suite.",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function findTestSite(): Promise<{ id: string }> {
  const svc = supabaseServiceClient();
  const { data, error } = await svc
    .from("sites")
    .select("id")
    .eq("prefix", E2E_TEST_SITE_PREFIX)
    .maybeSingle();
  if (error || !data) {
    throw new Error(
      `E2E test site not found (prefix ${E2E_TEST_SITE_PREFIX}): ${error?.message ?? "no row"}`,
    );
  }
  return { id: data.id as string };
}

test.describe("M13-5d appearance panel", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("renders panel structure with breadcrumbs + scope clarifier + event log", async ({
    page,
  }, testInfo) => {
    test.setTimeout(30_000);
    const site = await findTestSite();

    // Pre-seed an appearance_events row so the audit-log section has
    // content for the a11y audit.
    const svc = supabaseServiceClient();
    await svc.from("appearance_events").insert({
      site_id: site.id,
      event: "preflight_run",
      details: { outcome: "ready", stamped_first_detection: false },
    });

    await page.goto(`/admin/sites/${site.id}/appearance`);

    // Breadcrumb + heading.
    await expect(
      page.getByRole("heading", { level: 1, name: /^appearance$/i }),
    ).toBeVisible();
    await expect(
      page.getByText(/Sync this site's design-system palette/i),
    ).toBeVisible();

    // Scope clarifier note — must mention what Opollo owns vs not.
    await expect(
      page.getByText(/Opollo owns palette only/i),
    ).toBeVisible();
    await expect(
      page.getByText(/typography \+ spacing globals stay in WP Admin/i),
    ).toBeVisible();

    // Event log heading + the seeded preflight event surface.
    await expect(
      page.getByRole("heading", { name: /recent activity/i }),
    ).toBeVisible();
    await expect(page.getByText(/^Preflight$/i).first()).toBeVisible();

    // Wait for the loading banner to clear — /preflight either
    // succeeds or fails, but it shouldn't stay in the "Checking
    // Kadence…" state forever.
    await expect(
      page.getByText(/Checking Kadence on this site/i),
    ).not.toBeVisible({ timeout: 15_000 });

    await auditA11y(page, testInfo);
  });

  test("loading banner disappears after /preflight resolves", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const site = await findTestSite();
    await page.goto(`/admin/sites/${site.id}/appearance`);

    // Loading banner must be visible at first…
    const loadingText = page.getByText(/Checking Kadence on this site/i);
    // …then resolve to a terminal phase (any of: blocker, inactive,
    // ready, error).
    await expect(loadingText).not.toBeVisible({ timeout: 15_000 });

    // After /preflight resolves, one of the terminal-state surfaces
    // is visible. We don't pin which because the test WP backend is
    // environment-dependent; either branch is acceptable. The
    // re-check button is the consistent affordance across all
    // non-loading states.
    await expect(
      page.getByRole("button", { name: /re-check/i }),
    ).toBeVisible();
  });
});
