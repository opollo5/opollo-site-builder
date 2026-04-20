"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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

  const isSelf = selfUserId !== null && selfUserId === userId;

  async function post(endpoint: "revoke" | "reinstate") {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/${endpoint}`,
        { method: "POST" },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        setError(
          payload?.error?.message ??
            `${endpoint} failed (HTTP ${res.status}).`,
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
          onClick={() => void post("reinstate")}
          disabled={submitting}
          className="self-start rounded border px-2 py-0.5 text-[11px] hover:bg-muted disabled:opacity-60"
        >
          {submitting ? "…" : "Reinstate"}
        </button>
        {error && (
          <p role="alert" className="text-[11px] text-destructive">
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
        onClick={() => {
          if (!confirm("Revoke access? The user will be signed out and blocked from signing back in until reinstated.")) return;
          void post("revoke");
        }}
        disabled={isSelf || submitting}
        title={isSelf ? "You cannot revoke your own access." : undefined}
        className="self-start rounded border px-2 py-0.5 text-[11px] text-destructive hover:bg-destructive/10 disabled:opacity-60"
      >
        {submitting ? "…" : "Revoke"}
      </button>
      {error && (
        <p role="alert" className="text-[11px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
