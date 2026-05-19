import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

export interface CapAnalyticsSummary {
  subscriptionId: string;
  /** 30-day spend window */
  spentLast30DaysUsd: number;
  monthlyCostCapUsd: number;
  totalCampaigns: number;
  campaignsByStatus: Record<string, number>;
  totalPostsGenerated: number;
  totalPostsApproved: number;
  totalPostsPushed: number;
  totalRegenerateCount: number;
  totalGenerationRuns: number;
  avgCostPerCampaignUsd: number;
  /** Most recent campaign month (ISO date string) or null */
  latestCampaignMonth: string | null;
}

export async function getCapAnalyticsSummary(
  subscriptionId: string,
): Promise<CapAnalyticsSummary | null> {
  const svc = getServiceRoleClient();

  const { data: sub, error: subErr } = await svc
    .from("cap_subscriptions")
    .select("id, monthly_cost_cap_usd")
    .eq("id", subscriptionId)
    .maybeSingle();

  if (subErr || !sub) {
    logger.warn("cap.analytics.sub_not_found", { subscriptionId });
    return null;
  }

  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [campaigns, recentRuns] = await Promise.all([
    svc
      .from("cap_campaigns")
      .select("id, status, month")
      .eq("cap_subscription_id", subscriptionId),
    svc
      .from("cap_generation_runs")
      .select("estimated_cost_usd, cap_campaign_id")
      .gte("created_at", since30),
  ]);

  if (campaigns.error) {
    logger.warn("cap.analytics.campaigns_failed", { subscriptionId, error: campaigns.error.message });
  }

  const campaignRows = campaigns.data ?? [];
  const campaignIds = new Set(campaignRows.map((c: { id: string }) => c.id));

  // Filter recent runs to this subscription's campaigns
  const relevantRuns = (recentRuns.data ?? []).filter(
    (r: { cap_campaign_id: string }) => campaignIds.has(r.cap_campaign_id),
  );

  const spentLast30DaysUsd = relevantRuns.reduce(
    (sum: number, r: { estimated_cost_usd: string | number }) => sum + Number(r.estimated_cost_usd),
    0,
  );

  const campaignsByStatus: Record<string, number> = {};
  let latestCampaignMonth: string | null = null;

  for (const c of campaignRows as { id: string; status: string; month: string }[]) {
    campaignsByStatus[c.status] = (campaignsByStatus[c.status] ?? 0) + 1;
    if (!latestCampaignMonth || c.month > latestCampaignMonth) {
      latestCampaignMonth = c.month;
    }
  }

  // Post stats
  let totalPostsGenerated = 0;
  let totalPostsApproved = 0;
  let totalPostsPushed = 0;
  let totalRegenerateCount = 0;

  if (campaignIds.size > 0) {
    const { data: posts } = await svc
      .from("cap_campaign_posts")
      .select("status, regenerate_count")
      .in("cap_campaign_id", [...campaignIds]);

    for (const p of (posts ?? []) as { status: string; regenerate_count: number }[]) {
      if (["generated", "approved", "rejected", "pushed", "published", "approved_past_due"].includes(p.status)) {
        totalPostsGenerated++;
      }
      if (p.status === "approved" || p.status === "pushed" || p.status === "published") {
        totalPostsApproved++;
      }
      if (p.status === "pushed" || p.status === "published") {
        totalPostsPushed++;
      }
      totalRegenerateCount += p.regenerate_count ?? 0;
    }
  }

  const totalCampaigns = campaignRows.length;
  const avgCostPerCampaignUsd =
    totalCampaigns > 0 ? spentLast30DaysUsd / totalCampaigns : 0;

  return {
    subscriptionId,
    spentLast30DaysUsd,
    monthlyCostCapUsd: Number(sub.monthly_cost_cap_usd),
    totalCampaigns,
    campaignsByStatus,
    totalPostsGenerated,
    totalPostsApproved,
    totalPostsPushed,
    totalRegenerateCount,
    totalGenerationRuns: relevantRuns.length,
    avgCostPerCampaignUsd,
    latestCampaignMonth,
  };
}
