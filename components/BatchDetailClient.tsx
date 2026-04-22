"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ConfirmActionModal } from "@/components/ConfirmActionModal";
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
//      Opens a ConfirmActionModal that posts to /cancel + refreshes.
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
  const [cancelOpen, setCancelOpen] = useState(false);

  useEffect(() => {
    if (TERMINAL_STATUSES.has(status)) return;
    const t = setInterval(() => {
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [router, status]);

  const cancellable =
    status === "queued" || status === "running" || status === "partial";

  if (!cancellable) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        onClick={() => setCancelOpen(true)}
        className="text-destructive hover:bg-destructive/10"
      >
        Cancel batch
      </Button>
      {cancelOpen && (
        <ConfirmActionModal
          open
          title="Cancel this batch?"
          description="In-flight slots will finish; pending slots will be marked skipped."
          confirmLabel="Cancel batch"
          confirmVariant="destructive"
          endpoint={`/api/admin/batch/${encodeURIComponent(jobId)}/cancel`}
          request={{ method: "POST", body: {} }}
          onClose={() => setCancelOpen(false)}
          onSuccess={() => {
            setCancelOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
