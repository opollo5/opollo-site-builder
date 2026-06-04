"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import type { TicketStatus } from "@/lib/feedback/types";

// ---------------------------------------------------------------------------
// TicketTriageActions — staff-only controls on the admin ticket detail.
//
// §5: Move to backlog, Ignore (wont_fix), Delete (soft, with confirm).
// All three are human-staff-only and route through the existing PATCH/DELETE
// API endpoints which call update-status.ts. Each writes feedback_ticket_events.
// ---------------------------------------------------------------------------

type Props = {
  ticketId: string;
  currentStatus: TicketStatus;
};

const TRIAGE_ACTIONS: Array<{
  label: string;
  targetStatus?: TicketStatus;
  isDelete?: boolean;
  variant: "secondary" | "danger";
}> = [
  { label: "Move to backlog", targetStatus: "backlog", variant: "secondary" },
  { label: "Ignore", targetStatus: "wont_fix", variant: "secondary" },
  { label: "Delete", isDelete: true, variant: "danger" },
];

export function TicketTriageActions({ ticketId, currentStatus }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const handleStatusChange = useCallback(
    async (targetStatus: TicketStatus) => {
      setPending(targetStatus);
      setError(null);
      try {
        const resp = await fetch(`/api/feedback/tickets/${ticketId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: targetStatus }),
        });
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          setError(body?.error?.message ?? "Failed to update status.");
          return;
        }
        router.refresh();
      } finally {
        setPending(null);
      }
    },
    [ticketId, router],
  );

  const handleDelete = useCallback(async () => {
    setPending("delete");
    setError(null);
    try {
      const resp = await fetch(`/api/feedback/tickets/${ticketId}`, {
        method: "DELETE",
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setError(body?.error?.message ?? "Failed to delete ticket.");
        return;
      }
      // Redirect to the board after soft delete.
      router.push("/admin/feedback");
    } finally {
      setPending(null);
      setDeleteConfirm(false);
    }
  }, [ticketId, router]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {TRIAGE_ACTIONS.map((action) => {
        const isCurrentStatus =
          !action.isDelete && action.targetStatus === currentStatus;
        if (isCurrentStatus) return null;

        if (action.isDelete) {
          if (deleteConfirm) {
            return (
              <div key="delete-confirm" className="flex items-center gap-2">
                <span className="text-xs text-red-600">Delete this ticket? This cannot be undone.</span>
                <button
                  onClick={handleDelete}
                  disabled={pending === "delete"}
                  className="rounded px-2 py-1 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
                >
                  {pending === "delete" ? "Deleting…" : "Confirm delete"}
                </button>
                <button
                  onClick={() => setDeleteConfirm(false)}
                  className="rounded px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200"
                >
                  Cancel
                </button>
              </div>
            );
          }
          return (
            <button
              key="delete"
              onClick={() => setDeleteConfirm(true)}
              className="rounded px-2 py-1 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100"
            >
              Delete
            </button>
          );
        }

        return (
          <button
            key={action.targetStatus}
            onClick={() => handleStatusChange(action.targetStatus!)}
            disabled={!!pending}
            className="rounded px-2 py-1 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
          >
            {pending === action.targetStatus ? "Updating…" : action.label}
          </button>
        );
      })}
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}
