import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { AdminPortfolioKpis } from "@/lib/insights/admin-dashboard";

interface PortfolioKPIsProps {
  kpis: AdminPortfolioKpis;
}

function fmt(n: number, decimals = 1): string {
  return n.toLocaleString("en-AU", { maximumFractionDigits: decimals });
}

export function PortfolioKPIs({ kpis }: PortfolioKPIsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="portfolio-kpis">
      <Card className="border-b2">
        <CardHeader className="pb-2">
          <div className="text-sm uppercase tracking-wide text-tx-muted">Clients</div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold tabular-nums text-tx-primary">
            {kpis.totalClients}
          </div>
          <div className="text-sm text-tx-muted mt-1">{kpis.activeClients} active</div>
        </CardContent>
      </Card>

      <Card className="border-b2">
        <CardHeader className="pb-2">
          <div className="text-sm uppercase tracking-wide text-tx-muted">Avg eng rate</div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold tabular-nums text-tx-primary">
            {kpis.avgEngagementRate30d !== null
              ? `${fmt(kpis.avgEngagementRate30d * 100)}%`
              : "—"}
          </div>
          {kpis.engagementRateDelta !== null && (
            <div className="text-sm text-tx-muted mt-1">
              {kpis.engagementRateDelta > 0 ? "↑" : "↓"}{" "}
              {fmt(Math.abs(kpis.engagementRateDelta * 100), 2)}pp
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-b2">
        <CardHeader className="pb-2">
          <div className="text-sm uppercase tracking-wide text-tx-muted">Top performer</div>
        </CardHeader>
        <CardContent>
          <div className="text-lg font-semibold text-tx-primary line-clamp-1">
            {kpis.topPerformerName ?? "—"}
          </div>
          {kpis.topPerformerRate !== null && (
            <div className="text-sm text-tx-muted mt-1">
              {fmt(kpis.topPerformerRate * 100)}% avg
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-b2">
        <CardHeader className="pb-2">
          <div className="text-sm uppercase tracking-wide text-tx-muted">Declining</div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold tabular-nums text-rd">
            {kpis.decliningCount}
          </div>
          <div className="text-sm text-tx-muted mt-1">clients</div>
        </CardContent>
      </Card>
    </div>
  );
}
