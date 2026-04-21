"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// M3-8 — Batch detail client controls.
//
// Two responsibilities:
//
//   1. Auto-refresh. For non-terminal batches, poll via
//      router.refresh() every 3s so the operator watches progress
//      without hammering F5. Terminal batches (succeeded/failed/
//      cancelled) don't refresh — nothing changes.
//
//   2. Cancel button. Visible for queued/running/partial batches.
//      Posts to /cancel, refreshes. Disabled while posting.
// ---------------------------------------------------------------------------

const POLL_MS = 3_000;
const TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "cancelled",
]);

export function BatchDetailClient({
  jobId,
  status,
}: {
  jobId: string;
  status: string;
}) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (TERMINAL_STATUSES.has(status)) return;
    const t = setInterval(() => {
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [router, status]);

  async function handleCancel() {
    if (!confirm("Cancel this batch? In-flight slots will finish; pending slots will be marked skipped.")) {
      return;
    }
    setCancelling(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/batch/${encodeURIComponent(jobId)}/cancel`,
        { method: "POST" },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        setError(
          payload?.error?.message ??
            `Cancel failed (HTTP ${res.status}).`,
        );
        setCancelling(false);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCancelling(false);
    }
  }

  const cancellable =
    status === "queued" || status === "running" || status === "partial";

  if (!cancellable) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        onClick={handleCancel}
        disabled={cancelling}
        className="text-destructive hover:bg-destructive/10"
      >
        {cancelling ? "Cancelling…" : "Cancel batch"}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
