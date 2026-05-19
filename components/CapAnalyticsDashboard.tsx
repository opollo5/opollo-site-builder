import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CapAnalyticsSummary } from "@/lib/cap/analytics";

interface Props {
  analytics: CapAnalyticsSummary;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export function CapAnalyticsDashboard({ analytics }: Props) {
  const capPct =
    analytics.monthlyCostCapUsd > 0
      ? Math.round((analytics.spentLast30DaysUsd / analytics.monthlyCostCapUsd) * 100)
      : 0;

  const approvalRate =
    analytics.totalPostsGenerated > 0
      ? Math.round((analytics.totalPostsApproved / analytics.totalPostsGenerated) * 100)
      : 0;

  const latestMonth = analytics.latestCampaignMonth
    ? new Date(analytics.latestCampaignMonth).toLocaleString("en-AU", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : "—";

  return (
    <div className="space-y-6">
      {/* Cost overview */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Cost (last 30 days)
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Spend"
            value={`$${analytics.spentLast30DaysUsd.toFixed(2)}`}
            sub={`of $${analytics.monthlyCostCapUsd.toFixed(2)} cap (${capPct}%)`}
          />
          <StatCard
            label="Total generation runs"
            value={String(analytics.totalGenerationRuns)}
          />
          <StatCard
            label="Avg cost per campaign"
            value={`$${analytics.avgCostPerCampaignUsd.toFixed(2)}`}
          />
        </div>

        {/* Cost cap bar */}
        <div className="mt-3">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Monthly cost cap usage</span>
            <span>{capPct}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${capPct >= 90 ? "bg-destructive" : capPct >= 70 ? "bg-warning" : "bg-success"}`}
              style={{ width: `${Math.min(capPct, 100)}%` }}
            />
          </div>
        </div>
      </section>

      {/* Campaign stats */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Campaigns
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Total campaigns"
            value={String(analytics.totalCampaigns)}
            sub={`Latest: ${latestMonth}`}
          />
          <StatCard
            label="Posts generated"
            value={String(analytics.totalPostsGenerated)}
          />
          <StatCard
            label="Approval rate"
            value={`${approvalRate}%`}
            sub={`${analytics.totalPostsApproved} approved, ${analytics.totalPostsPushed} pushed`}
          />
        </div>
      </section>

      {/* Campaign status breakdown */}
      {Object.keys(analytics.campaignsByStatus).length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Campaign status breakdown
          </h2>
          <div className="grid gap-2 sm:grid-cols-4">
            {Object.entries(analytics.campaignsByStatus).map(([status, count]) => (
              <div key={status} className="rounded-md border border-border p-3 text-sm">
                <p className="font-medium capitalize">{status.replace(/_/g, " ")}</p>
                <p className="text-2xl font-bold">{count}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {analytics.totalRegenerateCount > 0 && (
        <p className="text-sm text-muted-foreground">
          Total regenerations: {analytics.totalRegenerateCount}
        </p>
      )}
    </div>
  );
}
