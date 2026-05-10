"use client";

import type { AnalyticsDashboard } from "@/lib/platform/social/analytics-ingest";

import {
  deltaColorClass,
  formatDeltaPercent,
  formatNumber,
} from "./format";
import { PLATFORM_COLOR } from "./platform-theme";

// HeroImpressionsBar — big stacked horizontal bar showing total
// impressions in the date range, broken down by platform, with the big
// number + delta arrow on the right. The Metricool aesthetic in one
// component.

export function HeroImpressionsBar({
  dashboard,
}: {
  dashboard: AnalyticsDashboard;
}) {
  const total = dashboard.total_impressions_period;
  if (total === 0) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <div className="text-sm font-medium text-muted-foreground">
          Total impressions ({dashboard.range_days}d)
        </div>
        <div className="mt-2 text-3xl font-bold text-muted-foreground">
          —
        </div>
        <div className="mt-3 text-sm text-muted-foreground">
          No impressions data for the selected window yet.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="flex items-end justify-between gap-6">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-muted-foreground">
            Total impressions ({dashboard.range_days}d)
          </div>
          <div className="mt-3 flex h-10 overflow-hidden rounded-md border bg-muted/30">
            {dashboard.platforms.map((p) => {
              const widthPct = (p.current.impressions_period / total) * 100;
              if (widthPct < 0.5) return null; // avoid sliver render
              return (
                <div
                  key={p.platform}
                  className="flex h-full items-center justify-center text-xs font-medium text-white"
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor: PLATFORM_COLOR[p.platform],
                  }}
                  title={`${p.platform}: ${formatNumber(p.current.impressions_period)} (${widthPct.toFixed(1)}%)`}
                >
                  {widthPct > 8 && formatNumber(p.current.impressions_period)}
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col items-end">
          <div className="text-3xl font-bold tracking-tight">
            {formatNumber(total)}
          </div>
          <div
            className={`mt-1 text-sm font-medium ${deltaColorClass(dashboard.total_impressions_delta_pct)}`}
          >
            {formatDeltaPercent(dashboard.total_impressions_delta_pct)} vs
            prior {dashboard.range_days}d
          </div>
        </div>
      </div>
    </div>
  );
}
