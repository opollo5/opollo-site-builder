import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Cost monitoring queries — WS4 hardening pass.
//
// Two aggregation surfaces:
//
//   capCostSummary(since) — CAP generation cost by company, past N hours
//   tenantBudgetSummary() — current daily/monthly usage vs caps for all
//                           tenant_cost_budgets rows
//
// Designed for the daily cost report cron (07:00 UTC). Both return typed
// summaries; callers format for email.
// ---------------------------------------------------------------------------

export interface CapCostRow {
  company_id: string;
  company_name: string;
  subscription_id: string;
  tier: string;
  monthly_cap_usd: number;
  period_cost_usd: number;
  run_count: number;
  cap_utilisation_pct: number;
}

export interface TenantBudgetRow {
  site_id: string;
  site_name: string | null;
  daily_usage_cents: number;
  daily_cap_cents: number;
  monthly_usage_cents: number;
  monthly_cap_cents: number;
  daily_utilisation_pct: number;
  monthly_utilisation_pct: number;
}

export interface CostReportData {
  generatedAt: string;
  periodHours: number;
  cap: {
    rows: CapCostRow[];
    totalPeriodCostUsd: number;
    subscriptionCount: number;
    highUtilisationCount: number;
  };
  tenant: {
    rows: TenantBudgetRow[];
    siteCount: number;
    dailyBreachedCount: number;
    monthlyBreachedCount: number;
  };
}

/**
 * Query CAP generation cost for all active/trial subscriptions within
 * the past `periodHours` hours (default 24).
 */
export async function capCostSummary(periodHours = 24): Promise<CapCostRow[]> {
  const svc = getServiceRoleClient();
  const since = new Date(Date.now() - periodHours * 60 * 60 * 1000).toISOString();

  // Get all active/trial subscriptions with company name
  const { data: subs, error: subsErr } = await svc
    .from("cap_subscriptions")
    .select("id, company_id, tier, monthly_cost_cap_usd, platform_companies(name)")
    .in("status", ["active", "trial"]);

  if (subsErr) {
    logger.warn("cost_monitoring.cap_query_failed", { error: subsErr.message });
    return [];
  }

  const rows: CapCostRow[] = [];

  for (const sub of subs ?? []) {
    // Get all campaign IDs for this subscription
    const { data: campaigns } = await svc
      .from("cap_campaigns")
      .select("id")
      .eq("cap_subscription_id", sub.id);

    const campaignIds = (campaigns ?? []).map((c: { id: string }) => c.id);

    let periodCostUsd = 0;
    let runCount = 0;

    if (campaignIds.length > 0) {
      const { data: runs, error: runsErr } = await svc
        .from("cap_generation_runs")
        .select("estimated_cost_usd")
        .in("cap_campaign_id", campaignIds)
        .gte("created_at", since)
        .eq("status", "success");

      if (runsErr) {
        logger.warn("cost_monitoring.runs_query_failed", { subscriptionId: sub.id, error: runsErr.message });
      } else {
        runCount = (runs ?? []).length;
        periodCostUsd = (runs ?? []).reduce(
          (sum: number, r: { estimated_cost_usd: string | number }) => sum + Number(r.estimated_cost_usd),
          0,
        );
      }
    }

    const monthlyCap = Number(sub.monthly_cost_cap_usd);
    const companyName = (sub.platform_companies as { name?: string } | null)?.name ?? sub.company_id;

    rows.push({
      company_id: sub.company_id,
      company_name: companyName,
      subscription_id: sub.id,
      tier: sub.tier,
      monthly_cap_usd: monthlyCap,
      period_cost_usd: periodCostUsd,
      run_count: runCount,
      cap_utilisation_pct: monthlyCap > 0 ? Math.round((periodCostUsd / monthlyCap) * 100 * 100) / 100 : 0,
    });
  }

  return rows.sort((a, b) => b.period_cost_usd - a.period_cost_usd);
}

/**
 * Query current tenant budget utilisation for all tenants.
 */
export async function tenantBudgetSummary(): Promise<TenantBudgetRow[]> {
  const svc = getServiceRoleClient();

  const { data: budgets, error } = await svc
    .from("tenant_cost_budgets")
    .select("site_id, daily_usage_cents, daily_cap_cents, monthly_usage_cents, monthly_cap_cents")
    .order("monthly_usage_cents", { ascending: false });

  if (error) {
    logger.warn("cost_monitoring.tenant_query_failed", { error: error.message });
    return [];
  }

  // Fetch site names in batch
  const siteIds = (budgets ?? []).map((b: { site_id: string }) => b.site_id);
  let siteNames: Record<string, string> = {};

  if (siteIds.length > 0) {
    const { data: sites } = await svc
      .from("sites")
      .select("id, name")
      .in("id", siteIds);

    for (const s of sites ?? []) {
      siteNames[s.id] = s.name ?? s.id;
    }
  }

  return (budgets ?? []).map((b: {
    site_id: string;
    daily_usage_cents: number;
    daily_cap_cents: number;
    monthly_usage_cents: number;
    monthly_cap_cents: number;
  }) => ({
    site_id: b.site_id,
    site_name: siteNames[b.site_id] ?? null,
    daily_usage_cents: b.daily_usage_cents,
    daily_cap_cents: b.daily_cap_cents,
    monthly_usage_cents: b.monthly_usage_cents,
    monthly_cap_cents: b.monthly_cap_cents,
    daily_utilisation_pct:
      b.daily_cap_cents > 0
        ? Math.round((b.daily_usage_cents / b.daily_cap_cents) * 100 * 100) / 100
        : 0,
    monthly_utilisation_pct:
      b.monthly_cap_cents > 0
        ? Math.round((b.monthly_usage_cents / b.monthly_cap_cents) * 100 * 100) / 100
        : 0,
  }));
}

/**
 * Assemble the full cost report. Called by the daily cron.
 */
export async function buildCostReport(periodHours = 24): Promise<CostReportData> {
  const [capRows, tenantRows] = await Promise.all([
    capCostSummary(periodHours),
    tenantBudgetSummary(),
  ]);

  const HIGH_UTILISATION_THRESHOLD = 80;

  return {
    generatedAt: new Date().toISOString(),
    periodHours,
    cap: {
      rows: capRows,
      totalPeriodCostUsd: capRows.reduce((s, r) => s + r.period_cost_usd, 0),
      subscriptionCount: capRows.length,
      highUtilisationCount: capRows.filter((r) => r.cap_utilisation_pct >= HIGH_UTILISATION_THRESHOLD).length,
    },
    tenant: {
      rows: tenantRows,
      siteCount: tenantRows.length,
      dailyBreachedCount: tenantRows.filter((r) => r.daily_utilisation_pct >= 100).length,
      monthlyBreachedCount: tenantRows.filter((r) => r.monthly_utilisation_pct >= 100).length,
    },
  };
}
