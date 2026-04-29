import { expect, test, type APIRequestContext } from "@playwright/test";

import { auditA11y, signInAsAdmin } from "./helpers";
import {
  seedLandingPage,
  seedOptClient,
  seedProposal,
  supabaseServiceClient,
} from "./optimiser-helpers";

// Change log + manual rollback — spec §5.1 + §9.10.

test.describe("optimiser — change log + rollback", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("change log renders proposal_approved + manual_rollback events", async ({
    page,
    request,
  }, testInfo) => {
    const client = await seedOptClient({
      slug: `log-${Date.now()}`,
      onboarded: true,
    });
    const lp = await seedLandingPage({
      clientId: client.id,
      url: "https://example.test/rollback-1",
      managed: true,
    });
    const proposal = await seedProposal({
      clientId: client.id,
      landingPageId: lp.id,
      headline: "Rollback Target",
      riskLevel: "low",
    });

    // Approve via the API so the change log gets a proposal_approved row.
    const approveRes = await request.post(
      `/api/optimiser/proposals/${proposal.id}/approve`,
      {
        headers: { "content-type": "application/json" },
        data: {},
      },
    );
    expect([200, 201]).toContain(approveRes.status());

    // Manual rollback via the API.
    const rollbackRes = await request.post(
      `/api/optimiser/proposals/${proposal.id}/rollback`,
      {
        headers: { "content-type": "application/json" },
        data: { reason: "E2E manual rollback test." },
      },
    );
    expect(rollbackRes.status()).toBe(200);

    await page.goto(`/optimiser/change-log?client=${client.id}`);
    await auditA11y(page, testInfo);

    await expect(page.getByText("proposal_approved")).toBeVisible();
    await expect(page.getByText("manual_rollback")).toBeVisible();

    // Confirm proposal status flipped.
    const supabase = supabaseServiceClient();
    const { data } = await supabase
      .from("opt_proposals")
      .select("status")
      .eq("id", proposal.id)
      .maybeSingle();
    expect(data?.status).toBe("applied_then_reverted");
  });

  test("rollback on a pending proposal returns ROLLBACK_FAILED", async ({
    request,
  }) => {
    const client = await seedOptClient({
      slug: `rb-pending-${Date.now()}`,
      onboarded: true,
    });
    const lp = await seedLandingPage({
      clientId: client.id,
      url: "https://example.test/pending-1",
      managed: true,
    });
    const proposal = await seedProposal({
      clientId: client.id,
      landingPageId: lp.id,
      status: "pending",
    });

    const res = await callApi(request, {
      method: "POST",
      url: `/api/optimiser/proposals/${proposal.id}/rollback`,
      body: { reason: "Should fail on pending." },
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      ok: false,
      error: { code: "ROLLBACK_FAILED" },
    });
  });
});

async function callApi(
  request: APIRequestContext,
  args: { method: "POST" | "GET"; url: string; body?: unknown },
): Promise<{ status: number; body: unknown }> {
  const res =
    args.method === "POST"
      ? await request.post(args.url, {
          headers: { "content-type": "application/json" },
          data: args.body ?? {},
        })
      : await request.get(args.url);
  const status = res.status();
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status, body };
}
