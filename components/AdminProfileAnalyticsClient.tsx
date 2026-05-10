"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyAnalyticsState } from "@/components/analytics/EmptyAnalyticsState";
import { HeroImpressionsBar } from "@/components/analytics/HeroImpressionsBar";
import { ImpressionsTimeSeries } from "@/components/analytics/ImpressionsTimeSeries";
import { PlatformStatCards } from "@/components/analytics/PlatformStatCards";
import { TopPostsPanel } from "@/components/analytics/TopPostsPanel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  AnalyticsDashboard,
  AnalyticsDateRange,
} from "@/lib/platform/social/analytics-ingest";

// AdminProfileAnalyticsClient — the per-profile analytics dashboard.
//
// State:
//   - dashboard: the data payload (refetched on range change)
//   - rangeDays: 7 | 30 | 90 (default 30)
//
// Surfaces:
//   - Date-range picker (left top)
//   - Refresh button (right top) — calls force-refresh; bundle.social
//     rate-limits this at 5/day/team/platform, so a toast surfaces
//     errors clearly.
//   - First-time empty state when is_first_time = true
//   - Otherwise: hero impressions bar, platform stat cards, time
//     series, top posts.

const RANGES: readonly AnalyticsDateRange[] = [7, 30, 90];

export function AdminProfileAnalyticsClient({
  companyId,
  profileId,
  profileName,
  initialDashboard,
}: {
  companyId: string;
  profileId: string;
  profileName: string;
  initialDashboard: AnalyticsDashboard;
}) {
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [rangeDays, setRangeDays] = useState<AnalyticsDateRange>(
    initialDashboard.range_days,
  );
  const [isPending, startTransition] = useTransition();
  const [isRefreshing, setIsRefreshing] = useState(false);

  function switchRange(next: AnalyticsDateRange) {
    if (next === rangeDays) return;
    setRangeDays(next);
    startTransition(() => {
      void (async () => {
        const r = await fetch(
          `/api/admin/companies/${companyId}/social-profiles/${profileId}/analytics/dashboard?range=${next}`,
        );
        const body = await r.json();
        if (r.ok && body.ok) {
          setDashboard(body.data as AnalyticsDashboard);
        } else {
          toast.error("Couldn't switch range", {
            description: body?.error?.message ?? `HTTP ${r.status}`,
          });
        }
      })();
    });
  }

  async function refresh() {
    setIsRefreshing(true);
    try {
      const r = await fetch(
        `/api/admin/companies/${companyId}/social-profiles/${profileId}/analytics/refresh`,
        { method: "POST" },
      );
      const body = await r.json();
      if (r.ok && body.ok) {
        toast.success("Refresh complete", {
          description: `${body.data.accounts_refreshed} accounts, ${body.data.posts_refreshed} posts`,
        });
        // Refetch the dashboard with the current range.
        const dashRes = await fetch(
          `/api/admin/companies/${companyId}/social-profiles/${profileId}/analytics/dashboard?range=${rangeDays}`,
        );
        const dashBody = await dashRes.json();
        if (dashRes.ok && dashBody.ok) {
          setDashboard(dashBody.data as AnalyticsDashboard);
        }
      } else {
        toast.error("Refresh failed", {
          description: body?.error?.message ?? `HTTP ${r.status}`,
        });
      }
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="analytics-dashboard">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">
            Range
          </span>
          <div
            className="inline-flex overflow-hidden rounded-md border"
            role="tablist"
            aria-label="Date range"
          >
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={r === rangeDays}
                onClick={() => switchRange(r)}
                disabled={isPending}
                className={`px-3 py-1.5 text-sm transition-colors ${
                  r === rangeDays
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-foreground hover:bg-muted"
                }`}
                data-testid={`range-tab-${r}`}
              >
                Last {r}d
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            Profile: <span className="font-medium">{profileName}</span>
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={isRefreshing}
            data-testid="analytics-refresh-button"
          >
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      {isPending ? (
        <DashboardSkeleton />
      ) : dashboard.is_first_time ? (
        <EmptyAnalyticsState dashboard={dashboard} />
      ) : (
        <>
          <HeroImpressionsBar dashboard={dashboard} />
          <PlatformStatCards dashboard={dashboard} />
          <ImpressionsTimeSeries dashboard={dashboard} />
          <TopPostsPanel dashboard={dashboard} />
        </>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" data-testid="analytics-skeleton">
      <Skeleton className="h-28 w-full" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-40 w-full" />
        ))}
      </div>
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
