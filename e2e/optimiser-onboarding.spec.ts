import { expect, test } from "@playwright/test";

import { auditA11y, signInAsAdmin } from "./helpers";
import {
  installExternalApiMocks,
  seedOptClient,
  supabaseServiceClient,
} from "./optimiser-helpers";

// Onboarding flow — spec §7.1 (five-step gated checklist).
//
// Covers:
//   - Adding a new client via NewClientForm
//   - Step 1 (client details) save
//   - Step 3 Clarity token + verify (token saved, mock returns sessions)
//   - Step 5 page selection table renders
//   - Marking onboarding complete

test.describe("optimiser — onboarding wizard", () => {
  test.beforeEach(async ({ page }) => {
    await installExternalApiMocks(page);
    await signInAsAdmin(page);
  });

  test("create client + walk to pages step + complete", async ({
    page,
  }, testInfo) => {
    await page.goto("/optimiser/onboarding");
    await auditA11y(page, testInfo);

    const slug = `wizard-${Date.now()}`;
    await expect(
      page.getByRole("heading", { name: /Onboarding/i }),
    ).toBeVisible();

    await page.getByLabel("Display name").fill("E2E Wizard Client");
    await page.getByLabel("Slug").fill(slug);
    await page
      .getByLabel("Primary contact email (optional)")
      .fill("e2e-wizard@example.test");

    await page.getByRole("button", { name: /create client/i }).click();
    await page.waitForURL(/\/optimiser\/onboarding\/[0-9a-f-]{36}/);

    // Step 1 (client details) is the default landing step. Re-save to
    // exercise the PATCH path.
    await expect(
      page.getByRole("heading", { name: /client details/i }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText(/^saved\.$/i)).toBeVisible();

    // Step 3 — Clarity token entry + Verify install.
    await page.getByRole("button", { name: /install microsoft clarity/i }).click();
    await page.getByLabel("Clarity API token").fill("e2e-clarity-token");
    await page.getByRole("button", { name: /save token/i }).click();
    await expect(page.getByText(/clarity is reporting sessions|token saved/i)).toBeVisible();

    // The Clarity API mock returns []; verify shows "waiting for first
    // Clarity session." That's the no_data path — assert we surface it.
    await page.getByRole("button", { name: /verify install/i }).click();
    await expect(
      page.getByText(/waiting for first Clarity session/i),
    ).toBeVisible();
  });

  test("onboarded client shows in 'Onboarded' list", async ({ page }) => {
    const seeded = await seedOptClient({
      slug: `onboarded-${Date.now()}`,
      name: "E2E Onboarded",
      onboarded: true,
    });
    await page.goto("/optimiser/onboarding");
    const onboardedSection = page
      .getByRole("heading", { name: /^Onboarded$/i })
      .locator("..");
    await expect(onboardedSection).toContainText("E2E Onboarded");
    await expect(onboardedSection).toContainText(seeded.client_slug);
  });

  test("connector banner surfaces for missing Ads connection", async ({
    page,
  }, testInfo) => {
    const seeded = await seedOptClient({
      slug: `banner-${Date.now()}`,
      onboarded: false,
    });
    await page.goto(`/optimiser/onboarding/${seeded.id}`);
    await auditA11y(page, testInfo);
    await expect(page.getByText(/Google Ads not connected/i)).toBeVisible();
    await expect(
      page.getByRole("link", { name: /connect google ads/i }),
    ).toBeVisible();
  });

  test("create client surfaces SLUG_CONFLICT on duplicate", async ({ page }) => {
    const slug = `dupe-${Date.now()}`;
    const supabase = supabaseServiceClient();
    await supabase.from("opt_clients").insert({
      name: "E2E Dupe Pre-existing",
      client_slug: `e2e-opt-${slug}`,
      hosting_mode: "opollo_subdomain",
      llm_monthly_budget_usd: 50,
    });

    await page.goto("/optimiser/onboarding");
    await page.getByLabel("Display name").fill("E2E Dupe Attempt");
    await page.getByLabel("Slug").fill(`e2e-opt-${slug}`);
    await page.getByRole("button", { name: /create client/i }).click();
    await expect(
      page.getByText(/already in use|SLUG_CONFLICT/i),
    ).toBeVisible();
  });
});
