import { Suspense } from "react";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { canDo, getCurrentPlatformSession } from "@/lib/platform/auth";
import { getInsightsDashboardData, type InsightsPeriod } from "@/lib/insights/dashboard";
import { InsightsDashboardClient } from "@/components/insights/InsightsDashboardClient";
import { CompetitorGapAnalysis } from "@/components/insights/CompetitorGapAnalysis";
import { PeriodSelector } from "@/components/insights/common/PeriodSelector";

export const dynamic = "force-dynamic";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const VALID_PERIODS: InsightsPeriod[] = ["7d", "30d", "90d"];

export default async function InsightsPage({
  searchParams,
}: {
  searchParams?: { period?: string };
}) {
  const session = await getCurrentPlatformSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent("/company/social/insights")}`);
  }
  if (!session.company) {
    redirect("/company");
  }

  const companyId = session.company.companyId;
  const canView = await canDo(companyId, "view_insights");
  if (!canView) {
    redirect("/company/social");
  }

  const rawPeriod = searchParams?.period;
  const period: InsightsPeriod = VALID_PERIODS.includes(rawPeriod as InsightsPeriod)
    ? (rawPeriod as InsightsPeriod)
    : "30d";

  const data = await getInsightsDashboardData(companyId, period);

  return (
    <PageShell>
      <PageHeader>
        <PageHeader.Breadcrumb
          segments={[
            { label: "Social", href: "/company/social/posts" },
            { label: "Insights" },
          ]}
        />
        <PageHeader.Title>Insights</PageHeader.Title>
        <PageHeader.Subtitle>
          Engagement performance across your connected accounts
        </PageHeader.Subtitle>
        <PageHeader.Meta>
          {data.dataFreshness.lastIngestIso && (
            <span className="text-sm text-tx-muted">
              Data through {formatDate(data.dataFreshness.lastIngestIso)}
            </span>
          )}
          {data.dataFreshness.isStale && (
            <StatusPill kind="warning" label="Stale data" />
          )}
        </PageHeader.Meta>
        <PageHeader.Actions>
          <PeriodSelector value={period} />
        </PageHeader.Actions>
      </PageHeader>

      <PageShell.Content>
        <InsightsDashboardClient data={data} companyId={companyId} />
        <Suspense fallback={null}>
          <CompetitorGapAnalysis companyId={companyId} />
        </Suspense>
      </PageShell.Content>
    </PageShell>
  );
}
