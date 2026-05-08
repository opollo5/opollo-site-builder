"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { toastSuccess } from "@/lib/toast-success";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { NavIcon } from "@/components/ui/nav-icon";
import { Pill } from "@/components/ui/pill";
import { TableCell } from "@/components/ui/table-cell";
import type { RowAction } from "@/components/ui/row-actions";
import { formatRelativeTime } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Spec 18 PR D — PendingInvitesTable migration.
//
// Replaced bespoke <table> with the canonical DataTable. Revoke moves
// from an inline button to the trailing `...` menu (destructive
// variant). The pre-existing ConfirmDialog gates the actual DELETE.
// ---------------------------------------------------------------------------

interface PendingInvite {
  id: string;
  email: string;
  role: "admin" | "user";
  invited_by_email: string | null;
  created_at: string;
  expires_at: string;
}

export function PendingInvitesTable({
  invites,
}: {
  invites: PendingInvite[];
}) {
  const router = useRouter();
  const [revoking, setRevoking] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<{
    id: string;
    email: string;
  } | null>(null);

  async function revoke(id: string, email: string) {
    setRevoking(id);
    try {
      const res = await fetch(
        `/api/admin/invites/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        toast.error("Couldn't revoke invite", {
          description:
            payload?.error?.message ??
            `Revoke failed (HTTP ${res.status}).`,
        });
        return;
      }
      toastSuccess(`Invite for ${email} revoked.`);
      router.refresh();
    } catch (err) {
      toast.error("Network error revoking invite", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRevoking(null);
    }
  }

  const columns: ColumnDef<PendingInvite>[] = [
    {
      key: "email",
      header: "Email",
      cell: (i) => <TableCell.Primary>{i.email}</TableCell.Primary>,
    },
    {
      key: "role",
      header: "Role",
      cell: (i) => <Pill variant="info">{i.role}</Pill>,
    },
    {
      key: "invited_by",
      header: "Invited by",
      cell: (i) =>
        i.invited_by_email ? (
          <TableCell.Secondary>{i.invited_by_email}</TableCell.Secondary>
        ) : (
          <TableCell.Secondary>(deleted user)</TableCell.Secondary>
        ),
    },
    {
      key: "sent",
      header: "Sent",
      cell: (i) => (
        <TableCell.Secondary>
          <span data-screenshot-mask>{formatRelativeTime(i.created_at)}</span>
        </TableCell.Secondary>
      ),
    },
    {
      key: "expires",
      header: "Expires",
      cell: (i) => {
        const expiresIn = new Date(i.expires_at).getTime() - Date.now();
        const expiringSoon = expiresIn < 60 * 60 * 1000;
        return (
          <span
            className={
              expiringSoon
                ? "text-sm text-warning"
                : "text-sm text-muted-foreground"
            }
            data-screenshot-mask
          >
            {formatRelativeTime(i.expires_at)}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(o) => {
          if (!o) setPendingRevoke(null);
        }}
        title="Revoke this invite?"
        description={
          pendingRevoke
            ? `Remove the pending invite for ${pendingRevoke.email}. They will not be able to use the invite link.`
            : undefined
        }
        confirmLabel="Revoke invite"
        confirmVariant="destructive"
        onConfirm={() =>
          pendingRevoke && void revoke(pendingRevoke.id, pendingRevoke.email)
        }
      />
      <DataTable
        data={invites}
        columns={columns}
        rowKey={(i) => i.id}
        testId="pending-invites-table"
        rowActions={(inv): RowAction[] => [
          {
            label: "Revoke invite",
            icon: <NavIcon name="cross-circle" size={14} />,
            variant: "destructive",
            disabled: revoking === inv.id,
            onClick: () => setPendingRevoke({ id: inv.id, email: inv.email }),
          },
        ]}
        emptyState={{
          icon: <NavIcon name="envelope" size={20} />,
          iconLabel: "No pending invitations",
          title: "No pending invitations",
          body: <>Invites you send will show up here until they&apos;re accepted.</>,
        }}
      />
    </>
  );
}
