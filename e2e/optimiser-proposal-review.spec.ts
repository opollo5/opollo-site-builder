import { expect, test } from "@playwright/test";

import { auditA11y, signInAsAdmin } from "./helpers";
import {
  installExternalApiMocks,
  seedAdGroupAndAd,
  seedLandingPage,
  seedOptClient,
  seedProposal,
  supabaseServiceClient,
} from "./optimiser-helpers";

// Proposal review — spec §9.8.

test.describe("optimiser — proposal review", () => {
  test.beforeEach(async ({ page }) => {
    await installExternalApiMocks(page);
    await signInAsAdmin(page);
  });

  test("proposal list shows pending row + opens review screen", async ({
    page,
  }, testInfo) => {
    const client = await seedOptClient({
      slug: `list-${Date.now()}`,
      onboarded: true,
    });
    const lp = await seedLandingPage({
      clientId: client.id,
      url: "https://example.test/proposal-1",
      managed: true,
      state: "active",
    });
    const ag = await seedAdGroupAndAd({
      clientId: client.id,
      finalUrl: "https://example.test/proposal-1",
      headlines: ["Get IT Support Now"],
      descriptions: ["Specialist managed IT for schools."],
    });
    const proposal = await seedProposal({
      clientId: client.id,
      landingPageId: lp.id,
      adGroupId: ag.adGroupId,
      headline: "Message mismatch",
      riskLevel: "medium",
    });

    await page.goto(`/optimiser/proposals?client=${client.id}`);
    await auditA11y(page, testInfo);
    await expect(page.getByText("Message mismatch")).toBeVisible();

    await page.getByRole("link", { name: /^review$/i }).first().click();
    await page.waitForURL(`/optimiser/proposals/${proposal.id}`);
    await expect(
      page.getByRole("heading", { name: /Message mismatch/i }),
    ).toBeVisible();
    await expect(page.getByText(/medium risk/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^approve all$/i }),
    ).toBeVisible();
  });

  test("approve flow updates status to approved", async ({ page }) => {
    const client = await seedOptClient({
      slug: `approve-${Date.now()}`,
      onboarded: true,
    });
    const lp = await seedLandingPage({
      clientId: client.id,
      url: "https://example.test/approve-1",
      managed: true,
    });
    const proposal = await seedProposal({
      clientId: client.id,
      landingPageId: lp.id,
      headline: "Approve Me",
      riskLevel: "low",
    });

    await page.goto(`/optimiser/proposals/${proposal.id}`);
    await page
      .getByPlaceholder(/Augment the brief/)
      .fill("Keep the existing testimonial component.");
    await page.getByRole("button", { name: /^approve all$/i }).click();
    await page.waitForURL(/\/optimiser\/proposals(\?|$)/);

    const supabase = supabaseServiceClient();
    const { data } = await supabase
      .from("opt_proposals")
      .select("status, pre_build_reprompt, approved_at")
      .eq("id", proposal.id)
      .maybeSingle();
    expect(data?.status).toBe("approved");
    expect(data?.pre_build_reprompt).toContain("testimonial");
    expect(data?.approved_at).not.toBeNull();
  });

  test("reject flow flips status + records memory entry", async ({ page }) => {
    const client = await seedOptClient({
      slug: `reject-${Date.now()}`,
      onboarded: true,
    });
    const lp = await seedLandingPage({
      clientId: client.id,
      url: "https://example.test/reject-1",
      managed: true,
    });
    const proposal = await seedProposal({
      clientId: client.id,
      landingPageId: lp.id,
      headline: "Reject Me",
      riskLevel: "low",
    });

    await page.goto(`/optimiser/proposals/${proposal.id}`);
    await page.getByRole("combobox").selectOption("design_conflict");
    await page
      .getByPlaceholder(/optional context/i)
      .fill("Doesn't match the brand voice.");
    await page.getByRole("button", { name: /^reject$/i }).click();
    await page.waitForURL(/\/optimiser\/proposals(\?|$)/);

    const supabase = supabaseServiceClient();
    const { data: prop } = await supabase
      .from("opt_proposals")
      .select("status, rejection_reason_code")
      .eq("id", proposal.id)
      .maybeSingle();
    expect(prop?.status).toBe("rejected");
    expect(prop?.rejection_reason_code).toBe("design_conflict");

    const { data: memory } = await supabase
      .from("opt_client_memory")
      .select("memory_type, count")
      .eq("client_id", client.id)
      .eq("memory_type", "rejected_pattern");
    expect((memory ?? []).length).toBeGreaterThan(0);
  });

  test("approve-after-expiry returns 409 + EXPIRED", async ({ page }) => {
    const client = await seedOptClient({
      slug: `expired-${Date.now()}`,
      onboarded: true,
    });
    const lp = await seedLandingPage({
      clientId: client.id,
      url: "https://example.test/expired-1",
      managed: true,
    });
    const proposal = await seedProposal({
      clientId: client.id,
      landingPageId: lp.id,
      headline: "Already Expired",
      expiresAt: new Date(Date.now() - 1000),
    });

    await page.goto(`/optimiser/proposals/${proposal.id}`);
    await page.getByRole("button", { name: /^approve all$/i }).click();
    await expect(
      page.getByText(/expired|regenerate/i),
    ).toBeVisible();
  });
});
