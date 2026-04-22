"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ---------------------------------------------------------------------------
// M8-5 — edit-tenant-budget modal + button.
//
// Admin-only. Opens a modal to update daily / monthly caps. Optimistic
// lock echoed back on submit; VERSION_CONFLICT surfaces the server
// message and keeps the modal open.
//
// Input is in DOLLARS (cleaner for operators) but sent in CENTS over
// the wire — the modal multiplies on submit and the API stores cents.
// ---------------------------------------------------------------------------

type BudgetProps = {
  site_id: string;
  daily_cap_cents: number;
  monthly_cap_cents: number;
  version_lock: number;
};

function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function dollarsToCents(raw: string): number | null {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

export function EditTenantBudgetButton({
  budget,
}: {
  budget: BudgetProps;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="edit-tenant-budget-button"
      >
        Edit caps
      </Button>
      {open && (
        <EditTenantBudgetModal
          budget={budget}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function EditTenantBudgetModal({
  budget,
  onClose,
}: {
  budget: BudgetProps;
  onClose: () => void;
}) {
  const router = useRouter();
  const [daily, setDaily] = useState(centsToDollars(budget.daily_cap_cents));
  const [monthly, setMonthly] = useState(
    centsToDollars(budget.monthly_cap_cents),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDaily(centsToDollars(budget.daily_cap_cents));
    setMonthly(centsToDollars(budget.monthly_cap_cents));
  }, [budget.daily_cap_cents, budget.monthly_cap_cents]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const dailyCents = dollarsToCents(daily);
    const monthlyCents = dollarsToCents(monthly);
    if (dailyCents === null || monthlyCents === null) {
      setError("Caps must be non-negative numbers (dollars, e.g. 5.00).");
      setSubmitting(false);
      return;
    }

    const patch: { daily_cap_cents?: number; monthly_cap_cents?: number } = {};
    if (dailyCents !== budget.daily_cap_cents) patch.daily_cap_cents = dailyCents;
    if (monthlyCents !== budget.monthly_cap_cents)
      patch.monthly_cap_cents = monthlyCents;
    if (patch.daily_cap_cents === undefined && patch.monthly_cap_cents === undefined) {
      onClose();
      return;
    }

    try {
      const res = await fetch(
        `/api/admin/sites/${encodeURIComponent(budget.site_id)}/budget`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expected_version: budget.version_lock,
            patch,
          }),
        },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        setError(
          payload?.error?.message ?? `Update failed (HTTP ${res.status}).`,
        );
        setSubmitting(false);
        return;
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-budget-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
        <h2 id="edit-budget-title" className="text-lg font-semibold">
          Edit budget caps
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Caps are in dollars. 0 pauses all billed work on this site until
          raised.
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label htmlFor="eb-daily" className="block text-sm font-medium">
              Daily cap ($)
            </label>
            <Input
              id="eb-daily"
              type="number"
              step="0.01"
              min="0"
              value={daily}
              onChange={(e) => setDaily(e.target.value)}
              disabled={submitting}
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="eb-monthly" className="block text-sm font-medium">
              Monthly cap ($)
            </label>
            <Input
              id="eb-monthly"
              type="number"
              step="0.01"
              min="0"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
              disabled={submitting}
            />
          </div>
          {error && (
            <p
              role="alert"
              className="text-sm text-destructive"
              data-testid="edit-tenant-budget-error"
            >
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save caps"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
