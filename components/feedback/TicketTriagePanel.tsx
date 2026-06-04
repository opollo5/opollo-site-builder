"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import type { TicketPriority, TicketStatus } from "@/lib/feedback/types";

// ---------------------------------------------------------------------------
// TicketTriagePanel — full triage controls for the admin ticket detail page.
//
// §7: status, assignee (Opollo staff only), priority — each writes a
// feedback_ticket_events row via the existing PATCH endpoint. Automation
// caller guard in update-status.ts is unchanged.
// Soft-delete with confirm step also lives here.
// ---------------------------------------------------------------------------

type StaffOption = { id: string; fullName: string | null; email: string };

type Props = {
  ticketId: string;
  currentStatus: TicketStatus;
  currentAssigneeId: string | null;
  currentPriority: TicketPriority;
  staffList: StaffOption[];
};

const HUMAN_STATUSES: TicketStatus[] = [
  "backlog",
  "triaged",
  "in_progress",
  "fixed",
  "verified",
  "wont_fix",
  "closed",
];

const PRIORITIES: TicketPriority[] = ["low", "medium", "high", "urgent"];

export function TicketTriagePanel({
  ticketId,
  currentStatus,
  currentAssigneeId,
  currentPriority,
  staffList,
}: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<TicketStatus>(currentStatus);
  const [assigneeId, setAssigneeId] = useState<string | null>(currentAssigneeId);
  const [priority, setPriority] = useState<TicketPriority>(currentPriority);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const patch = useCallback(
    async (fields: Record<string, unknown>) => {
      setSaving(true);
      setError(null);
      try {
        const resp = await fetch(`/api/feedback/tickets/${ticketId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fields),
        });
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          setError(body?.error?.message ?? "Failed to save.");
          return false;
        }
        router.refresh();
        return true;
      } finally {
        setSaving(false);
      }
    },
    [ticketId, router],
  );

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    setError(null);
    try {
      const resp = await fetch(`/api/feedback/tickets/${ticketId}`, { method: "DELETE" });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setError(body?.error?.message ?? "Failed to delete.");
        return;
      }
      router.push("/admin/feedback");
    } finally {
      setDeleting(false);
      setDeleteConfirm(false);
    }
  }, [ticketId, router]);

  return (
    <div className="flex flex-wrap items-end gap-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
      {/* Status */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-600">Status</label>
        <select
          value={status}
          onChange={async (e) => {
            const next = e.target.value as TicketStatus;
            setStatus(next);
            await patch({ status: next });
          }}
          disabled={saving}
          className="min-h-[36px] rounded-md border border-gray-200 bg-white px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
        >
          {HUMAN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>

      {/* Priority — admin-only */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-600">Priority</label>
        <select
          value={priority}
          onChange={async (e) => {
            const next = e.target.value as TicketPriority;
            setPriority(next);
            await patch({ priority: next });
          }}
          disabled={saving}
          className="min-h-[36px] rounded-md border border-gray-200 bg-white px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {/* Assignee — Opollo staff only */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-600">Assignee</label>
        <select
          value={assigneeId ?? ""}
          onChange={async (e) => {
            const next = e.target.value || null;
            setAssigneeId(next);
            await patch({ assigneeId: next });
          }}
          disabled={saving}
          className="min-h-[36px] rounded-md border border-gray-200 bg-white px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
        >
          <option value="">Unassigned</option>
          {staffList.map((s) => (
            <option key={s.id} value={s.id}>
              {s.fullName ?? s.email}
            </option>
          ))}
        </select>
      </div>

      {/* Soft delete with confirm */}
      <div className="ml-auto flex items-center gap-2">
        {deleteConfirm ? (
          <>
            <span className="text-xs text-red-600">Delete this ticket?</span>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="min-h-[36px] rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Confirm"}
            </button>
            <button
              onClick={() => setDeleteConfirm(false)}
              className="min-h-[36px] rounded-md bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={() => setDeleteConfirm(true)}
            className="min-h-[36px] rounded-md px-3 py-1 text-xs font-medium text-red-500 hover:bg-red-50"
          >
            Delete
          </button>
        )}
      </div>

      {error && (
        <p className="w-full text-xs text-red-500">{error}</p>
      )}
    </div>
  );
}
