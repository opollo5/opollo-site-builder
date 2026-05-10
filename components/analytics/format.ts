// Display formatters for the analytics dashboard. Pure functions — kept
// in one place so the stat cards, top-posts panel, and per-platform
// drill-downs all read the same way.

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(n) >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`;
  }
  return n.toLocaleString();
}

export function formatDeltaPercent(pct: number | null): string {
  if (pct == null) return "—";
  const sign = pct >= 0 ? "↑" : "↓";
  return `${sign} ${Math.abs(pct).toFixed(1)}%`;
}

export function deltaColorClass(pct: number | null): string {
  if (pct == null) return "text-muted-foreground";
  if (pct > 0) return "text-emerald-600";
  if (pct < 0) return "text-rose-600";
  return "text-muted-foreground";
}

export function formatEngagementRate(rate: number | null | undefined): string {
  if (rate == null) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  const d = new Date(t);
  return d.toLocaleDateString();
}

export function formatAbsoluteTime(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const d = new Date(t);
  return d.toLocaleString();
}
