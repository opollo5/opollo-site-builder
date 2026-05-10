"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { reportableToast } from "@/lib/error-reporting/reportable-toast";
import { toastSuccess } from "@/lib/toast-success";
import { ConfirmActionModal } from "@/components/ConfirmActionModal";

// ---------------------------------------------------------------------------
// C-2 — Optimistic UI on reinstate. Revoke flows through
// ConfirmActionModal which already toasts on success/failure; the
// reinstate path was the inline-button gap.
// ---------------------------------------------------------------------------

export function UserStatusActionCell({
  userId,
  revoked,
  selfUserId,
}: {
  userId: string;
  revoked: boolean;
  selfUserId: string | null;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  // Optimistic local mirror — flips to "active" on reinstate request,
  // rolls back to "revoked" on failure.
  const [optimisticRevoked, setOptimisticRevoked] = useState(revoked);

  const isSelf = selfUserId !== null && selfUserId === userId;

  async function reinstate() {
    setSubmitting(true);
    setOptimisticRevoked(false);
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/reinstate`,
        { method: "POST" },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        setOptimisticRevoked(true);
        const desc =
          payload?.error?.message ??
          `Reinstate failed (HTTP ${res.status}). Status restored to revoked.`;
        reportableToast.error("Couldn't reinstate user", { message: desc }, { description: desc });
        return;
      }
      toastSuccess("User reinstated");
      router.refresh();
    } catch (err) {
      setOptimisticRevoked(true);
      const errMsg = err instanceof Error ? err.message : String(err);
      reportableToast.error("Network error reinstating user", { message: errMsg }, { description: errMsg });
    } finally {
      setSubmitting(false);
    }
  }

  // R1-11 — sparse-data tables feel less marooned with horizontal
  // status + action layout (was vertical stack with self-start button).
  if (optimisticRevoked) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-destructive">revoked</span>
        <button
          type="button"
          onClick={() => void reinstate()}
          disabled={submitting}
          className="rounded border px-2 py-0.5 text-sm transition-smooth hover:bg-muted disabled:opacity-60"
        >
          {submitting ? "…" : "Reinstate"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">active</span>
      <button
        type="button"
        onClick={() => setRevokeOpen(true)}
        disabled={isSelf || submitting}
        title={isSelf ? "You cannot revoke your own access." : undefined}
        className="rounded border px-2 py-0.5 text-sm text-destructive transition-smooth hover:bg-destructive/10 disabled:opacity-60"
      >
        {submitting ? "…" : "Revoke"}
      </button>
      {revokeOpen && (
        <ConfirmActionModal
          open
          title="Revoke access?"
          description="The user will be signed out and blocked from signing back in until reinstated."
          confirmLabel="Revoke"
          confirmVariant="destructive"
          endpoint={`/api/admin/users/${encodeURIComponent(userId)}/revoke`}
          request={{ method: "POST", body: {} }}
          onClose={() => setRevokeOpen(false)}
          onSuccess={() => {
            setRevokeOpen(false);
            setOptimisticRevoked(true);
            toastSuccess("User revoked");
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
