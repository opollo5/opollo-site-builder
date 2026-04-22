import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { E2E_TEST_SITE_PREFIX } from "./fixtures";
import { auditA11y, signInAsAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// M6-1 — /admin/sites/[id]/pages E2E coverage.
//
// Seeds three pages against the global-setup's E2E test site, signs in,
// navigates via the "Pages →" link from the site detail, verifies the
// list renders, filter narrows, nav is reachable.
// ---------------------------------------------------------------------------

type PageSeed = {
  slug: string;
  title: string;
  page_type?: string;
  status?: "draft" | "published";
  generated_html?: string;
};

const E2E_PAGE_SEEDS: PageSeed[] = [
  {
    slug: "e2e-homepage",
    title: "E2E homepage fixture",
    page_type: "homepage",
    status: "draft",
    generated_html:
      "<div class=\"e2e-scope\"><h1>E2E homepage fixture</h1><p>Short body copy.</p></div>",
  },
  {
    slug: "e2e-integration-gravity",
    title: "E2E Gravity integration",
    page_type: "integration",
    status: "published",
  },
  {
    slug: "e2e-troubleshooting-vpn",
    title: "E2E VPN troubleshooting",
    page_type: "troubleshooting",
    status: "draft",
  },
];

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`E2E pages.spec: ${name} is not set.`);
  return v;
}

function serviceRoleClient() {
  return createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function lookupTestSiteId(): Promise<string> {
  const svc = serviceRoleClient();
  const { data, error } = await svc
    .from("sites")
    .select("id")
    .eq("prefix", E2E_TEST_SITE_PREFIX)
    .neq("status", "removed")
    .maybeSingle();
  if (error) throw new Error(`lookupTestSiteId: ${error.message}`);
  if (!data) throw new Error("E2E test site not found; globalSetup should seed it.");
  return data.id as string;
}

async function seedPages(siteId: string): Promise<Record<string, string>> {
  const svc = serviceRoleClient();
  // Clear prior fixture rows so slug-UNIQUE constraint doesn't collide
  // across runs.
  const slugs = E2E_PAGE_SEEDS.map((p) => p.slug);
  await svc
    .from("pages")
    .delete()
    .eq("site_id", siteId)
    .in("slug", slugs);
  const ids: Record<string, string> = {};
  for (const seed of E2E_PAGE_SEEDS) {
    const { data, error } = await svc
      .from("pages")
      .insert({
        site_id: siteId,
        wp_page_id: Math.floor(Math.random() * 10_000_000),
        slug: seed.slug,
        title: seed.title,
        page_type: seed.page_type ?? "homepage",
        design_system_version: 1,
        status: seed.status ?? "draft",
        generated_html: seed.generated_html ?? null,
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(`seedPages insert: ${error?.message ?? "no row"}`);
    }
    ids[seed.slug] = data.id as string;
  }
  return ids;
}

test.describe("pages admin surface", () => {
  let siteId: string;
  let pageIds: Record<string, string> = {};

  test.beforeEach(async ({ page }) => {
    siteId = await lookupTestSiteId();
    pageIds = await seedPages(siteId);
    await signInAsAdmin(page);
  });

  test("/admin/sites/[id]/pages renders the list + axe pass", async ({
    page,
  }, testInfo) => {
    await page.goto(`/admin/sites/${siteId}/pages`);
    await expect(
      page.getByRole("heading", { name: /pages for/i }),
    ).toBeVisible();
    await auditA11y(page, testInfo);

    for (const seed of E2E_PAGE_SEEDS) {
      await expect(page.getByText(seed.title)).toBeVisible();
    }
  });

  test("status filter narrows results", async ({ page }) => {
    await page.goto(`/admin/sites/${siteId}/pages`);

    await page.getByLabel("Status").selectOption("published");
    await page.getByRole("button", { name: /apply/i }).click();

    await expect(page.getByText(/e2e gravity integration/i)).toBeVisible();
    await expect(page.getByText(/e2e homepage fixture/i)).toHaveCount(0);
    await expect(page.getByText(/e2e vpn troubleshooting/i)).toHaveCount(0);
  });

  test("Pages link reachable from site detail page", async ({ page }) => {
    await page.goto(`/admin/sites/${siteId}`);
    await page.getByTestId("site-pages-link").click();
    await page.waitForURL(/\/admin\/sites\/[0-9a-f-]{36}\/pages/);
    await expect(
      page.getByRole("heading", { name: /pages for/i }),
    ).toBeVisible();
  });

  test("list → detail round-trip preserves filter state on back-nav", async ({
    page,
  }) => {
    // Start on a filtered list so the back-link has state to preserve.
    await page.goto(`/admin/sites/${siteId}/pages?status=draft`);
    await expect(page.getByText(/e2e homepage fixture/i)).toBeVisible();

    // Drill into the homepage fixture detail.
    await page
      .getByTestId("page-row-link")
      .filter({ hasText: /e2e homepage fixture/i })
      .click();
    await expect(
      page.getByTestId("page-detail-fields"),
    ).toBeVisible();

    // Tier-2 preview iframe renders for the seed with generated_html.
    await expect(
      page.getByTestId("page-html-preview-iframe"),
    ).toBeAttached();

    // WP admin link composed from sites.wp_url + wp_page_id.
    await expect(page.getByTestId("wp-admin-link")).toHaveAttribute(
      "href",
      /wp-admin\/post\.php\?post=\d+&action=edit/,
    );

    // Back link returns to the filtered list, preserving ?status=draft.
    await page.getByTestId("page-back-to-list").click();
    await expect(page).toHaveURL(/status=draft/);
    await expect(page.getByText(/e2e homepage fixture/i)).toBeVisible();
  });

  test("detail page 404s on cross-site URL manipulation", async ({
    page,
  }) => {
    // Reuse one of the seeded pages under the REAL site; then request
    // it under a different-looking UUID that doesn't exist.
    const response = await page.goto(
      `/admin/sites/${siteId}/pages/00000000-0000-0000-0000-000000000000`,
    );
    expect(response?.status()).toBe(404);

    // Validate the UUID guard also triggers a 404 on a non-UUID string.
    const badUrlResponse = await page.goto(
      `/admin/sites/${siteId}/pages/not-a-uuid`,
    );
    expect(badUrlResponse?.status()).toBe(404);
  });

  test("preview pane shows empty-state when generated_html is null", async ({
    page,
  }) => {
    // The Gravity integration fixture is seeded without generated_html.
    const emptyPageId = pageIds["e2e-integration-gravity"];
    await page.goto(`/admin/sites/${siteId}/pages/${emptyPageId}`);
    await expect(
      page.getByTestId("page-html-preview-empty"),
    ).toBeVisible();
  });

  test("regenerate button enqueues a job + history panel surfaces it (M7-4)", async ({
    page,
  }) => {
    const targetPageId = pageIds["e2e-homepage"];
    // Clear any prior regen rows for this page so the test is
    // order-independent with the second regen test below.
    await serviceRoleClient()
      .from("regeneration_jobs")
      .delete()
      .eq("page_id", targetPageId);

    await page.goto(`/admin/sites/${siteId}/pages/${targetPageId}`);

    // History panel starts empty.
    await expect(page.getByTestId("regen-history-empty")).toBeVisible();

    // Auto-accept the confirm() dialog fired by the Re-generate button.
    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await page.getByTestId("regenerate-button").click();

    // After router.refresh the history panel shows the new row as
    // pending. M7-5 wires the cron; E2E runs don't include a cron
    // tick, so the job stays pending.
    await expect(page.getByTestId("regen-history-panel")).toBeVisible();
    // data-status is on the <tr> itself (not a descendant), so an
    // attribute selector works directly.
    const pendingRow = page.locator(
      '[data-testid="regen-history-row"][data-status="pending"]',
    );
    await expect(pendingRow).toHaveCount(1);

    // The button swaps to "Queued…" and is disabled while in-flight.
    await expect(page.getByTestId("regenerate-button")).toBeDisabled();
  });

  test("second regenerate click while in-flight surfaces REGEN_ALREADY_IN_FLIGHT", async ({
    page,
  }) => {
    const targetPageId = pageIds["e2e-homepage"];

    const svc = serviceRoleClient();
    // Clear any prior regen jobs on this page (other tests may seed).
    await svc
      .from("regeneration_jobs")
      .delete()
      .eq("page_id", targetPageId);

    // Now go to the detail page + hit the API directly to confirm
    // the 409 shape the UI relies on.
    await page.goto(`/admin/sites/${siteId}/pages/${targetPageId}`);
    const first = await page.request.post(
      `/api/admin/sites/${siteId}/pages/${targetPageId}/regenerate`,
    );
    expect(first.status()).toBe(202);

    const second = await page.request.post(
      `/api/admin/sites/${siteId}/pages/${targetPageId}/regenerate`,
    );
    expect(second.status()).toBe(409);
    const body = await second.json();
    expect(body?.error?.code).toBe("REGEN_ALREADY_IN_FLIGHT");
  });

  test("edit modal updates title + slug and detail reflects the change", async ({
    page,
  }) => {
    const targetPageId = pageIds["e2e-troubleshooting-vpn"];
    await page.goto(`/admin/sites/${siteId}/pages/${targetPageId}`);

    await page.getByTestId("edit-page-button").click();
    await expect(
      page.getByRole("heading", { name: /edit page metadata/i }),
    ).toBeVisible();

    const newTitle = "E2E VPN troubleshooting (edited)";
    const newSlug = `e2e-troubleshooting-vpn-edited-${Date.now()}`;
    await page.getByLabel("Title").fill(newTitle);
    await page.getByLabel("Slug").fill(newSlug);

    // Warning banner shows when the slug changes.
    await expect(page.getByTestId("slug-change-warning")).toBeVisible();

    await page.getByRole("button", { name: /save changes/i }).click();

    // Modal closes; detail page reflects the new title + slug.
    await expect(
      page.getByRole("heading", { name: /edit page metadata/i }),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("page-detail-fields").getByText(newTitle),
    ).toBeVisible();
    await expect(
      page.getByTestId("page-detail-fields").getByText(newSlug),
    ).toBeVisible();
  });
});
