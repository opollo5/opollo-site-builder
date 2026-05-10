"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { reportableToast } from "@/lib/error-reporting/reportable-toast";
import { toastSuccess } from "@/lib/toast-success";
import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import { ChangeUserRoleModal } from "@/components/ChangeUserRoleModal";
import { NavIcon } from "@/components/ui/nav-icon";
import { RowActions, type RowAction } from "@/components/ui/row-actions";

// ---------------------------------------------------------------------------
// Spec 18 PR B — Users `...` overflow menu.
//
// Replaces the inline role dropdown + inline Revoke button (which mixed
// per-row interactivity into the cell content). Edits flow through a
// modal opened from this menu — same pattern as Sites' SiteActionsMenu.
//
// Items:
//   - Change role        → opens ChangeUserRoleModal
//   - Reinstate          → POST /api/admin/users/[id]/reinstate (only when revoked)
//   - Revoke access      → opens ConfirmActionModal calling
//                          POST /api/admin/users/[id]/revoke (only when active)
//
// `super_admin` rows have role-change disabled — DB-level guard
// blocks demotion regardless. Self rows have both items disabled per
// the role/revoke route guards.
// ---------------------------------------------------------------------------

type Role = "super_admin" | "admin" | "user";

export interface UserActionsMenuProps {
  userId: string;
  email: string;
  currentRole: Role;
  revoked: boolean;
  selfUserId: string | null;
}

export function UserActionsMenu({
  userId,
  email,
  currentRole,
  revoked,
  selfUserId,
}: UserActionsMenuProps) {
  const router = useRouter();
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isSelf = selfUserId !== null && selfUserId === userId;
  const isSuperAdmin = currentRole === "super_admin";

  async function reinstate() {
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/reinstate`,
        { method: "POST" },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        const desc =
          payload?.error?.message ??
          `Reinstate failed (HTTP ${res.status}).`;
        reportableToast.error("Couldn't reinstate user", { message: desc }, { description: desc });
        return;
      }
      toastSuccess("User reinstated");
      router.refresh();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      reportableToast.error("Network error reinstating user", { message: errMsg }, { description: errMsg });
    } finally {
      setSubmitting(false);
    }
  }

  const actions: RowAction[] = [
    {
      label: "Change role",
      icon: <NavIcon name="users" size={14} />,
      onClick: () => setRoleModalOpen(true),
      disabled: isSelf || isSuperAdmin || submitting,
    },
    revoked
      ? {
          label: "Reinstate access",
          icon: <NavIcon name="checkmark-circle" size={14} />,
          onClick: () => {
            void reinstate();
          },
          disabled: isSelf || submitting,
        }
      : {
          label: "Revoke access",
          icon: <NavIcon name="cross-circle" size={14} />,
          variant: "destructive" as const,
          onClick: () => setRevokeOpen(true),
          disabled: isSelf || submitting,
        },
  ];

  return (
    <>
      <RowActions
        actions={actions}
        label={`Actions for ${email}`}
        testId={`user-actions-${userId}`}
      />
      {roleModalOpen && (
        <ChangeUserRoleModal
          open
          userId={userId}
          email={email}
          currentRole={currentRole}
          onClose={() => setRoleModalOpen(false)}
          onSuccess={() => {
            setRoleModalOpen(false);
            toastSuccess(`Role updated for ${email}`);
            router.refresh();
          }}
        />
      )}
      {revokeOpen && (
        <ConfirmActionModal
          open
          title="Revoke access?"
          description={`${email} will be signed out and blocked from signing back in until reinstated.`}
          confirmLabel="Revoke"
          confirmVariant="destructive"
          endpoint={`/api/admin/users/${encodeURIComponent(userId)}/revoke`}
          request={{ method: "POST", body: {} }}
          onClose={() => setRevokeOpen(false)}
          onSuccess={() => {
            setRevokeOpen(false);
            toastSuccess("User revoked");
            router.refresh();
          }}
        />
      )}
    </>
  );
}
