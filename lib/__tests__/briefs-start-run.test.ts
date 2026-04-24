import { describe, expect, it } from "vitest";

import { startBriefRun, estimateBriefRunCost } from "@/lib/briefs";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M12-4 — startBriefRun + pre-flight cost estimate tests.
//
// Covers parent-plan Risk #15 (operator-blind overspend).
// ---------------------------------------------------------------------------

async function seedCommittedBriefWithPages(
  siteId: string,
  pageCount: number,
  models?: { text_model?: string; visual_model?: string },
): Promise<{ briefId: string }> {
  const svc = getServiceRoleClient();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const briefRes = await svc
    .from("briefs")
    .insert({
      site_id: siteId,
      title: `start-run-test ${unique}`,
      status: "committed",
      source_storage_path: `start-run-test/${unique}.md`,
      source_mime_type: "text/markdown",
      source_size_bytes: 128,
      source_sha256: "0".repeat(64),
      upload_idempotency_key: `start-run-test-${unique}`,
      committed_at: new Date().toISOString(),
      committed_page_hash: "b".repeat(64),
      text_model: models?.text_model ?? "claude-sonnet-4-6",
      visual_model: models?.visual_model ?? "claude-sonnet-4-6",
    })
    .select("id")
    .single();
  if (briefRes.error || !briefRes.data) {
    throw new Error(`seed: ${briefRes.error?.message}`);
  }
  const briefId = briefRes.data.id as string;

  for (let i = 0; i < pageCount; i++) {
    const r = await svc
      .from("brief_pages")
      .insert({
        brief_id: briefId,
        ordinal: i,
        title: `Page ${i}`,
        mode: "full_text",
        source_text: "page source",
        word_count: 2,
      })
      .select("id")
      .single();
    if (r.error) throw new Error(`seed page ${i}: ${r.error.message}`);
  }
  return { briefId };
}

describe("estimateBriefRunCost", () => {
  it("returns a positive estimate for a committed brief", async () => {
    const site = await seedSite();
    const { briefId } = await seedCommittedBriefWithPages(site.id, 3);
    const res = await estimateBriefRunCost(briefId);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.page_count).toBe(3);
      expect(res.estimate_cents).toBeGreaterThan(0);
    }
  });

  it("returns NOT_FOUND for an unknown brief id", async () => {
    const res = await estimateBriefRunCost(
      "00000000-0000-4000-8000-000000000000",
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");
  });
});

describe("startBriefRun", () => {
  it("happy path — tenant budget comfortably exceeds estimate", async () => {
    const site = await seedSite();
    const { briefId } = await seedCommittedBriefWithPages(site.id, 2);
    const res = await startBriefRun({
      briefId,
      startedBy: null,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.brief_run_id).toBeTruthy();
      expect(res.data.estimate_cents).toBeGreaterThan(0);
    }
  });

  it("VALIDATION_FAILED when brief is not committed", async () => {
    const site = await seedSite();
    const svc = getServiceRoleClient();
    const { briefId } = await seedCommittedBriefWithPages(site.id, 2);
    await svc.from("briefs").update({ status: "parsed" }).eq("id", briefId);

    const res = await startBriefRun({ briefId, startedBy: null });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("VALIDATION_FAILED");
  });

  it("CONFIRMATION_REQUIRED when estimate > 50% of remaining budget", async () => {
    const site = await seedSite();
    const svc = getServiceRoleClient();
    const { briefId } = await seedCommittedBriefWithPages(site.id, 2);
    // Tight budget: cap 100, usage 0 → remaining 100. Estimate for 2
    // sonnet pages comfortably exceeds 50 cents (> 50% of 100).
    await svc
      .from("tenant_cost_budgets")
      .update({
        monthly_cap_cents: 100,
        monthly_usage_cents: 0,
        daily_cap_cents: 100_000_000,
        daily_usage_cents: 0,
      })
      .eq("site_id", site.id);

    const res = await startBriefRun({ briefId, startedBy: null });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("CONFIRMATION_REQUIRED");
      const details = res.error.details as {
        estimate_cents: number;
        remaining_budget_cents: number;
      };
      expect(details.estimate_cents).toBeGreaterThan(
        details.remaining_budget_cents * 0.5,
      );
    }
  });

  it("proceeds when caller sets confirmed: true over the threshold", async () => {
    const site = await seedSite();
    const svc = getServiceRoleClient();
    const { briefId } = await seedCommittedBriefWithPages(site.id, 2);
    await svc
      .from("tenant_cost_budgets")
      .update({
        monthly_cap_cents: 100,
        monthly_usage_cents: 0,
        daily_cap_cents: 100_000_000,
        daily_usage_cents: 0,
      })
      .eq("site_id", site.id);

    const res = await startBriefRun({
      briefId,
      startedBy: null,
      confirmed: true,
    });
    expect(res.ok).toBe(true);
  });

  it("BRIEF_RUN_ALREADY_ACTIVE when a second start races the partial UNIQUE index", async () => {
    const site = await seedSite();
    const { briefId } = await seedCommittedBriefWithPages(site.id, 2);
    const first = await startBriefRun({ briefId, startedBy: null });
    expect(first.ok).toBe(true);

    const second = await startBriefRun({ briefId, startedBy: null });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe("BRIEF_RUN_ALREADY_ACTIVE");
    }
  });
});
