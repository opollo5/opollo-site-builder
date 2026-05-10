"use client";

import type { AnalyticsDashboard } from "@/lib/platform/social/analytics-ingest";

import { formatAbsoluteTime } from "./format";

// First-time empty state when no snapshots have landed yet. Surfaces
// in-flight post-history imports so the operator knows the system is
// working.

export function EmptyAnalyticsState({
  dashboard,
}: {
  dashboard: AnalyticsDashboard;
}) {
  const hasInFlightImports = dashboard.active_imports.length > 0;
  return (
    <div className="rounded-lg border border-dashed bg-card p-10">
      <div className="mx-auto max-w-xl text-center">
        <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-2xl">
          ✨
        </div>
        <h3 className="text-lg font-semibold">Analytics are on the way</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          We&apos;re pulling your social analytics. Most data appears within
          24 hours; post history import may take up to 15 minutes after
          connecting an account.
        </p>
        {hasInFlightImports && (
          <div className="mt-6 space-y-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              In-progress imports
            </div>
            <ul
              className="space-y-2 text-left"
              data-testid="active-imports-list"
            >
              {dashboard.active_imports.map((imp) => (
                <li
                  key={imp.id}
                  className="flex items-center justify-between rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <div>
                    <div className="font-medium">{imp.platform}</div>
                    <div className="text-xs text-muted-foreground">
                      Started {formatAbsoluteTime(imp.started_at ?? imp.created_at)}
                    </div>
                  </div>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                    {imp.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
