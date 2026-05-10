"use client";

import { PLATFORM_LABEL } from "@/lib/platform/social/variants/types";
import type { AnalyticsDashboard } from "@/lib/platform/social/analytics-ingest";

import {
  deltaColorClass,
  formatDeltaPercent,
  formatNumber,
} from "./format";
import {
  PLATFORM_COLOR,
  PLATFORM_INITIALS,
  platformHasAnalytics,
} from "./platform-theme";

export function PlatformStatCards({
  dashboard,
}: {
  dashboard: AnalyticsDashboard;
}) {
  if (dashboard.platforms.length === 0) {
    return null;
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {dashboard.platforms.map((p) => {
        const hasAnalytics = platformHasAnalytics(p.platform);
        return (
          <div
            key={p.platform}
            className={`rounded-lg border bg-card p-5 transition-shadow hover:shadow-sm ${hasAnalytics ? "" : "opacity-60"}`}
            data-testid={`platform-stat-card-${p.platform}`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md font-bold text-white"
                  style={{ backgroundColor: PLATFORM_COLOR[p.platform] }}
                  aria-hidden="true"
                >
                  {PLATFORM_INITIALS[p.platform]}
                </span>
                <span className="text-sm font-medium text-foreground">
                  {PLATFORM_LABEL[p.platform]}
                </span>
              </div>
            </div>
            <div className="mt-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Impressions ({dashboard.range_days}d)
              </div>
              {hasAnalytics ? (
                <>
                  <div className="mt-1 text-2xl font-bold tracking-tight">
                    {formatNumber(p.current.impressions_period)}
                  </div>
                  <div
                    className={`mt-0.5 text-xs font-medium ${deltaColorClass(p.impressions_delta_pct)}`}
                  >
                    {formatDeltaPercent(p.impressions_delta_pct)}
                  </div>
                </>
              ) : (
                <div
                  className="mt-1 text-sm italic text-muted-foreground"
                  title="This platform's API doesn't expose impressions."
                >
                  Not exposed
                </div>
              )}
            </div>
            {hasAnalytics && (
              <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-xs">
                <div>
                  <div className="font-medium text-muted-foreground">
                    Followers
                  </div>
                  <div className="mt-0.5 text-sm font-semibold">
                    {formatNumber(p.current.followers)}
                  </div>
                </div>
                <div>
                  <div className="font-medium text-muted-foreground">
                    Posts
                  </div>
                  <div className="mt-0.5 text-sm font-semibold">
                    {formatNumber(p.current.post_count)}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
