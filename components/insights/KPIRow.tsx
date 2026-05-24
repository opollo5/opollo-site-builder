import { KPICard } from "./KPICard";
import type { InsightsDashboardData } from "@/lib/insights/dashboard";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

interface KPIRowProps {
  kpis: NonNullable<InsightsDashboardData["kpis"]>;
  availableMetrics: InsightsDashboardData["availableMetrics"];
}

export function KPIRow({ kpis, availableMetrics }: KPIRowProps) {
  const cards: React.ReactNode[] = [];

  if (availableMetrics.reach && kpis.reach30d !== null) {
    cards.push(
      <KPICard
        key="reach"
        label="Reach"
        value={formatNumber(kpis.reach30d)}
        data-testid="kpi-reach"
      />,
    );
  }

  if (kpis.avgEngagementRate30d !== null) {
    cards.push(
      <KPICard
        key="engagement"
        label="Avg engagement rate"
        value={`${(kpis.avgEngagementRate30d * 100).toFixed(1)}%`}
        data-testid="kpi-engagement"
      />,
    );
  }

  if (kpis.followerGrowth30d !== null) {
    cards.push(
      <KPICard
        key="followers"
        label="Follower growth"
        value={`+${kpis.followerGrowth30d}`}
        deltaPositive
        data-testid="kpi-followers"
      />,
    );
  }

  if (kpis.bestPost) {
    cards.push(
      <KPICard
        key="best"
        label="Best post"
        value={`${(kpis.bestPost.engagementRate * 100).toFixed(1)}%`}
        data-testid="kpi-best-post"
      />,
    );
  }

  if (cards.length === 0) return null;

  const colClass =
    cards.length === 4
      ? "grid-cols-2 lg:grid-cols-4"
      : cards.length === 3
        ? "grid-cols-2 lg:grid-cols-3"
        : "grid-cols-2";

  return (
    <div
      className={`grid gap-4 ${colClass}`}
      data-testid="kpi-row"
    >
      {cards}
    </div>
  );
}
