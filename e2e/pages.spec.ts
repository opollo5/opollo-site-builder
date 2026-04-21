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
};

const E2E_PAGE_SEEDS: PageSeed[] = [
  {
    slug: "e2e-homepage",
    title: "E2E homepage fixture",
    page_type: "homepage",
    status: "draft",
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

async function seedPages(siteId: string): Promise<void> {
  const svc = serviceRoleClient();
  // Clear prior fixture rows so slug-UNIQUE constraint doesn't collide
  // across runs.
  const slugs = E2E_PAGE_SEEDS.map((p) => p.slug);
  await svc
    .from("pages")
    .delete()
    .eq("site_id", siteId)
    .in("slug", slugs);
  for (const seed of E2E_PAGE_SEEDS) {
    const { error } = await svc.from("pages").insert({
      site_id: siteId,
      wp_page_id: Math.floor(Math.random() * 10_000_000),
      slug: seed.slug,
      title: seed.title,
      page_type: seed.page_type ?? "homepage",
      design_system_version: 1,
      status: seed.status ?? "draft",
    });
    if (error) throw new Error(`seedPages insert: ${error.message}`);
  }
}

test.describe("pages admin surface", () => {
  let siteId: string;

  test.beforeEach(async ({ page }) => {
    siteId = await lookupTestSiteId();
    await seedPages(siteId);
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
});
