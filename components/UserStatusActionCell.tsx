"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmActionModal } from "@/components/ConfirmActionModal";

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
  const [error, setError] = useState<string | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);

  const isSelf = selfUserId !== null && selfUserId === userId;

  async function reinstate() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/reinstate`,
        { method: "POST" },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        setError(
          payload?.error?.message ??
            `reinstate failed (HTTP ${res.status}).`,
        );
        setSubmitting(false);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  if (revoked) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs text-destructive">revoked</span>
        <button
          type="button"
          onClick={() => void reinstate()}
          disabled={submitting}
          className="self-start rounded border px-2 py-0.5 text-sm hover:bg-muted disabled:opacity-60"
        >
          {submitting ? "…" : "Reinstate"}
        </button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">active</span>
      <button
        type="button"
        onClick={() => setRevokeOpen(true)}
        disabled={isSelf || submitting}
        title={isSelf ? "You cannot revoke your own access." : undefined}
        className="self-start rounded border px-2 py-0.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-60"
      >
        {submitting ? "…" : "Revoke"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
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
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
