import type { TenantBudget } from "@/lib/tenant-budgets";

// ---------------------------------------------------------------------------
// M8-5 — tenant budget usage badge.
//
// Server-rendered. Two bars (daily + monthly) with current usage vs
// cap + the next reset time. Cap = 0 renders as "paused" — no enqueue
// allowed until operator raises the cap.
// ---------------------------------------------------------------------------

function formatCents(cents: number): string {
  if (cents === 0) return "$0";
  return `$${(cents / 100).toFixed(2)}`;
}

function formatResetAt(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
  } catch {
    return iso;
  }
}

function usagePct(usage: number, cap: number): number {
  if (cap <= 0) return 100;
  return Math.min(100, Math.round((usage / cap) * 100));
}

function barClass(pct: number, capped: boolean): string {
  if (capped) return "bg-muted";
  if (pct >= 90) return "bg-destructive";
  if (pct >= 70) return "bg-yellow-500";
  return "bg-emerald-500";
}

function Row({
  label,
  usage,
  cap,
  resetAt,
}: {
  label: string;
  usage: number;
  cap: number;
  resetAt: string;
}) {
  const pct = usagePct(usage, cap);
  const paused = cap === 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {paused ? (
            <span className="text-destructive">Paused</span>
          ) : (
            <>
              {formatCents(usage)} / {formatCents(cap)}
              <span className="ml-1">({pct}%)</span>
            </>
          )}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
        <div
          className={`h-full ${barClass(pct, paused)}`}
          style={{ width: `${paused ? 100 : pct}%` }}
        />
      </div>
      <div className="text-sm text-muted-foreground">
        Resets {formatResetAt(resetAt)}
      </div>
    </div>
  );
}

export function TenantBudgetBadge({ budget }: { budget: TenantBudget | null }) {
  if (!budget) {
    return (
      <div
        className="rounded-md border border-dashed p-3 text-xs text-muted-foreground"
        data-testid="tenant-budget-missing"
      >
        No budget row. Every enqueue will self-heal via the tenant-budget
        upsert in `reserveBudget`.
      </div>
    );
  }

  return (
    <div
      className="space-y-3 rounded-md border p-3"
      data-testid="tenant-budget-badge"
    >
      <Row
        label="Daily"
        usage={budget.daily_usage_cents}
        cap={budget.daily_cap_cents}
        resetAt={budget.daily_reset_at}
      />
      <Row
        label="Monthly"
        usage={budget.monthly_usage_cents}
        cap={budget.monthly_cap_cents}
        resetAt={budget.monthly_reset_at}
      />
    </div>
  );
}
