"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

// P3-4 — per-row revoke action on the company detail's pending invitations
// table. Calls DELETE /api/platform/invitations/[id]; the route gates on
// requireCanDoForApi(companyId, "manage_invitations") so opollo staff +
// customer admins both reach it. On success: router.refresh() so the row
// disappears from the table.

export function PlatformRevokeInvitationButton({
  invitationId,
  email,
}: {
  invitationId: string;
  email: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (submitting) return;
    if (
      !globalThis.confirm(
        `Revoke the pending invitation to ${email}? This cannot be undone — they would need a fresh invite to join.`,
      )
    ) {
      return;
    }
    setSubmitting(true);
    setError(null);

    const response = await fetch(
      `/api/platform/invitations/${invitationId}`,
      { method: "DELETE" },
    );
    const json = (await response.json().catch(() => null)) as {
      ok: boolean;
      error?: { code: string; message: string };
    } | null;

    if (!response.ok || !json?.ok) {
      setError(
        json?.error?.message ?? `Request failed (${response.status}).`,
      );
      setSubmitting(false);
      return;
    }

    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleClick}
        disabled={submitting}
        data-testid={`revoke-invitation-${invitationId}`}
      >
        {submitting ? "Revoking…" : "Revoke"}
      </Button>
      {error ? (
        <span
          role="alert"
          className="text-sm text-destructive"
          data-testid={`revoke-invitation-error-${invitationId}`}
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}
