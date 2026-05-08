// Streaming skeleton shown while the server fetches analytics data.
export default function AnalyticsLoading() {
  return (
    <div className="space-y-10 animate-pulse">
      {/* Header */}
      <div className="space-y-2">
        <div className="h-8 w-40 rounded bg-muted" />
        <div className="h-4 w-64 rounded bg-muted" />
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-4 space-y-2">
            <div className="h-3 w-28 rounded bg-muted" />
            <div className="h-8 w-16 rounded bg-muted" />
            <div className="h-3 w-20 rounded bg-muted" />
          </div>
        ))}
      </div>

      {/* Trend chart placeholder */}
      <div className="space-y-3">
        <div className="h-4 w-48 rounded bg-muted" />
        <div className="h-52 rounded-lg border bg-card" />
      </div>

      {/* Platform chart */}
      <div className="space-y-3">
        <div className="h-4 w-36 rounded bg-muted" />
        <div className="h-56 rounded-lg border bg-card" />
      </div>

      {/* Two-column section */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="h-4 w-32 rounded bg-muted" />
          <div className="h-56 rounded-lg border bg-card" />
        </div>
        <div className="space-y-3">
          <div className="h-4 w-24 rounded bg-muted" />
          <div className="h-56 rounded-lg border bg-card" />
        </div>
      </div>

      {/* Recent posts table */}
      <div className="space-y-3">
        <div className="h-4 w-40 rounded bg-muted" />
        <div className="overflow-hidden rounded-lg border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-4 border-b px-4 py-3 last:border-0">
              <div className="h-4 flex-1 rounded bg-muted" />
              <div className="h-4 w-24 rounded bg-muted" />
              <div className="h-4 w-20 rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
