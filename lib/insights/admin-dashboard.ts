import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";

export interface AdminClientRow {
  companyId: string;
  name: string;
  lastPostAt: string | null;
  lastPostRelative: string;
  trendData30d: number[];
  healthStatus: "green" | "amber" | "red";
  openRecs: number;
  dismissedRecs: number;
  lastAdminActionAt: string | null;
  lastAdminActionOperator: string | null;
}

export interface AdminPortfolioKpis {
  totalClients: number;
  activeClients: number;
  avgEngagementRate30d: number | null;
  engagementRateDelta: number | null;
  topPerformerName: string | null;
  topPerformerRate: number | null;
  decliningCount: number;
}

export interface AdminClientSnapshot {
  companyId: string;
  name: string;
  healthStatus: "green" | "amber" | "red";
  openRecs: number;
  dismissedRecs: number;
  lastAdminActionAt: string | null;
  lastAdminActionOperator: string | null;
}

export interface CompareDataPoint {
  companyId: string;
  name: string;
  avgEngagementRate30d: number | null;
  postCount30d: number;
  trendData30d: number[];
}

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function deriveHealth(
  lastPostAt: string | null,
  avgEngagementRate: number | null,
): "green" | "amber" | "red" {
  if (!lastPostAt) return "red";
  const daysSincePost = (Date.now() - new Date(lastPostAt).getTime()) / 86400000;
  if (daysSincePost > 7) return "red";
  if (daysSincePost > 3) return "amber";
  if (avgEngagementRate !== null && avgEngagementRate < 0.01) return "amber";
  return "green";
}

export async function getAdminRoster(): Promise<AdminClientRow[]> {
  const svc = getServiceRoleClient();

  // Fetch all companies with social profiles
  const { data: companies, error: compErr } = await svc
    .from("platform_companies")
    .select("id, name")
    .order("name");

  if (compErr || !companies) return [];

  // For each company, fetch 30d trend + health data
  const rows: AdminClientRow[] = [];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  await Promise.all(
    companies.map(async (co) => {
      // Get profile ids for this company
      const { data: profiles } = await svc
        .from("platform_social_profiles")
        .select("id")
        .eq("company_id", co.id);

      const profileIds = (profiles ?? []).map((p) => p.id);

      if (profileIds.length === 0) {
        rows.push({
          companyId: co.id,
          name: co.name,
          lastPostAt: null,
          lastPostRelative: "Never",
          trendData30d: [],
          healthStatus: "red",
          openRecs: 0,
          dismissedRecs: 0,
          lastAdminActionAt: null,
          lastAdminActionOperator: null,
        });
        return;
      }

      // Fetch recent snapshots
      const { data: snapshots } = await svc
        .from("social_post_analytics_snapshots")
        .select("captured_at, engagement_rate")
        .in("social_profile_id", profileIds)
        .gte("captured_at", thirtyDaysAgo)
        .order("captured_at", { ascending: true });

      const snaps = snapshots ?? [];
      const trendData30d = snaps.map((s) => s.engagement_rate ?? 0);
      const lastPostAt = snaps.length > 0 ? snaps[snaps.length - 1].captured_at : null;
      const avgEngRate =
        snaps.length > 0
          ? snaps.reduce((sum, s) => sum + (s.engagement_rate ?? 0), 0) / snaps.length
          : null;

      // Recs
      const { count: openRecs } = await svc
        .from("ins_recommendations")
        .select("id", { count: "exact", head: true })
        .eq("company_id", co.id)
        .eq("suppressed", false);

      const { count: dismissedRecs } = await svc
        .from("ins_recommendations")
        .select("id", { count: "exact", head: true })
        .eq("company_id", co.id)
        .eq("suppressed", true);

      // Last admin action
      const { data: lastAudit } = await svc
        .from("ins_admin_audit")
        .select("occurred_at, operator_user_id")
        .eq("client_company_id", co.id)
        .order("occurred_at", { ascending: false })
        .limit(1);

      const auditRow = lastAudit?.[0] ?? null;

      rows.push({
        companyId: co.id,
        name: co.name,
        lastPostAt,
        lastPostRelative: relativeTime(lastPostAt),
        trendData30d,
        healthStatus: deriveHealth(lastPostAt, avgEngRate),
        openRecs: openRecs ?? 0,
        dismissedRecs: dismissedRecs ?? 0,
        lastAdminActionAt: auditRow?.occurred_at ?? null,
        lastAdminActionOperator: auditRow?.operator_user_id ?? null,
      });
    }),
  );

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAdminPortfolioKpis(roster: AdminClientRow[]): Promise<AdminPortfolioKpis> {
  const activeClients = roster.filter((r) => r.trendData30d.length > 0).length;
  const ratesWithData = roster.filter((r) => r.trendData30d.length > 0);
  const avgEngagementRate30d =
    ratesWithData.length > 0
      ? ratesWithData.reduce((sum, r) => {
          const avg =
            r.trendData30d.reduce((s, v) => s + v, 0) / r.trendData30d.length;
          return sum + avg;
        }, 0) / ratesWithData.length
      : null;

  const topPerformer = ratesWithData.reduce<AdminClientRow | null>((best, r) => {
    const avg = r.trendData30d.reduce((s, v) => s + v, 0) / r.trendData30d.length;
    if (!best) return r;
    const bestAvg = best.trendData30d.reduce((s, v) => s + v, 0) / best.trendData30d.length;
    return avg > bestAvg ? r : best;
  }, null);

  const topPerformerRate = topPerformer
    ? topPerformer.trendData30d.reduce((s, v) => s + v, 0) / topPerformer.trendData30d.length
    : null;

  const decliningCount = roster.filter((r) => r.healthStatus === "red").length;

  return {
    totalClients: roster.length,
    activeClients,
    avgEngagementRate30d,
    engagementRateDelta: null, // future: compare vs prev period
    topPerformerName: topPerformer?.name ?? null,
    topPerformerRate,
    decliningCount,
  };
}

export async function getAdminClientSnapshot(companyId: string): Promise<AdminClientSnapshot | null> {
  const svc = getServiceRoleClient();

  const { data: co } = await svc
    .from("platform_companies")
    .select("id, name")
    .eq("id", companyId)
    .single();

  if (!co) return null;

  const { count: openRecs } = await svc
    .from("ins_recommendations")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("suppressed", false);

  const { count: dismissedRecs } = await svc
    .from("ins_recommendations")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("suppressed", true);

  const { data: lastAudit } = await svc
    .from("ins_admin_audit")
    .select("occurred_at, operator_user_id")
    .eq("client_company_id", companyId)
    .order("occurred_at", { ascending: false })
    .limit(1);

  const auditRow = lastAudit?.[0] ?? null;

  return {
    companyId: co.id,
    name: co.name,
    healthStatus: "green",
    openRecs: openRecs ?? 0,
    dismissedRecs: dismissedRecs ?? 0,
    lastAdminActionAt: auditRow?.occurred_at ?? null,
    lastAdminActionOperator: auditRow?.operator_user_id ?? null,
  };
}

export async function getCompareData(companyIds: string[]): Promise<CompareDataPoint[]> {
  const svc = getServiceRoleClient();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  const results: CompareDataPoint[] = [];

  await Promise.all(
    companyIds.map(async (companyId) => {
      const { data: co } = await svc
        .from("platform_companies")
        .select("id, name")
        .eq("id", companyId)
        .single();

      if (!co) return;

      const { data: profiles } = await svc
        .from("platform_social_profiles")
        .select("id")
        .eq("company_id", companyId);

      const profileIds = (profiles ?? []).map((p) => p.id);
      if (profileIds.length === 0) {
        results.push({
          companyId,
          name: co.name,
          avgEngagementRate30d: null,
          postCount30d: 0,
          trendData30d: [],
        });
        return;
      }

      const { data: snapshots } = await svc
        .from("social_post_analytics_snapshots")
        .select("captured_at, engagement_rate")
        .in("social_profile_id", profileIds)
        .gte("captured_at", thirtyDaysAgo)
        .order("captured_at", { ascending: true });

      const snaps = snapshots ?? [];
      const trendData30d = snaps.map((s) => s.engagement_rate ?? 0);
      const avgEngagementRate30d =
        snaps.length > 0
          ? snaps.reduce((sum, s) => sum + (s.engagement_rate ?? 0), 0) / snaps.length
          : null;

      results.push({
        companyId,
        name: co.name,
        avgEngagementRate30d,
        postCount30d: snaps.length,
        trendData30d,
      });
    }),
  );

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getRecentAdminActivity(
  limit = 10,
): Promise<Array<{ operatorUserId: string; clientCompanyId: string; action: string; occurredAt: string }>> {
  const svc = getServiceRoleClient();
  const { data } = await svc
    .from("ins_admin_audit")
    .select("operator_user_id, client_company_id, action, occurred_at")
    .order("occurred_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => ({
    operatorUserId: row.operator_user_id,
    clientCompanyId: row.client_company_id,
    action: row.action,
    occurredAt: row.occurred_at,
  }));
}
