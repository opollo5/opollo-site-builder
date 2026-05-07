"use client";

import { PlatformInviteUserModal } from "@/components/PlatformInviteUserModal";
import { PlatformRevokeInvitationButton } from "@/components/PlatformRevokeInvitationButton";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { NavIcon } from "@/components/ui/nav-icon";
import { Pill, type PillVariant } from "@/components/ui/pill";
import { TableCell } from "@/components/ui/table-cell";
import { H1, Lead } from "@/components/ui/typography";
import type {
  CompanyDetail,
  CompanyMember,
  CompanyPendingInvitation,
} from "@/lib/platform/companies";

// ---------------------------------------------------------------------------
// Spec 18 PR D — Members card migration.
//
// Two tables under the Customer-side users surface:
//
//   1. Members            — DataTable, no row actions today (member
//                           management still happens via per-member
//                           detail screens; documented as a follow-up).
//   2. Pending invitations — DataTable + RowActions with Revoke
//                            (destructive). Re-uses
//                            PlatformRevokeInvitationButton's API call
//                            via a thin onClick that mirrors its body.
//
// Empty state copy preserved verbatim ("No members yet — click Invite
// user…") per spec instruction.
// ---------------------------------------------------------------------------

const ROLE_VARIANT: Record<CompanyMember["role"], PillVariant> = {
  admin: "info",
  approver: "warning",
  editor: "neutral",
  viewer: "neutral",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const MEMBER_COLUMNS: ColumnDef<CompanyMember>[] = [
  {
    key: "name",
    header: "Name",
    cell: (m) =>
      m.full_name ? (
        <TableCell.Primary>{m.full_name}</TableCell.Primary>
      ) : (
        <TableCell.Empty />
      ),
  },
  {
    key: "email",
    header: "Email",
    cell: (m) => <TableCell.Mono>{m.email}</TableCell.Mono>,
  },
  {
    key: "role",
    header: "Role",
    cell: (m) => (
      <Pill variant={ROLE_VARIANT[m.role] ?? "neutral"}>{m.role}</Pill>
    ),
  },
  {
    key: "joined",
    header: "Joined",
    cell: (m) => <TableCell.Secondary>{formatDate(m.joined_at)}</TableCell.Secondary>,
  },
];

const PENDING_COLUMNS: ColumnDef<CompanyPendingInvitation>[] = [
  {
    key: "email",
    header: "Email",
    cell: (i) => <TableCell.Mono>{i.email}</TableCell.Mono>,
  },
  {
    key: "role",
    header: "Role",
    cell: (i) => (
      <Pill variant="info">{i.role}</Pill>
    ),
  },
  {
    key: "sent",
    header: "Sent",
    cell: (i) => <TableCell.Secondary>{formatDate(i.created_at)}</TableCell.Secondary>,
  },
  {
    key: "expires",
    header: "Expires",
    cell: (i) => <TableCell.Secondary>{formatDate(i.expires_at)}</TableCell.Secondary>,
  },
  {
    key: "actions",
    header: <span className="sr-only">Actions</span>,
    width: "120px",
    align: "right",
    cell: (i) => (
      <span onClick={(e) => e.stopPropagation()}>
        <PlatformRevokeInvitationButton invitationId={i.id} email={i.email} />
      </span>
    ),
  },
];

export function CustomerCompanyUsersView({
  detail,
}: {
  detail: CompanyDetail;
}) {
  const { company, members, pending_invitations } = detail;

  return (
    <div className="space-y-8">
      <header>
        <H1>Users</H1>
        <Lead className="mt-1">
          Manage users for <strong>{company.name}</strong>.
        </Lead>
      </header>

      <section
        className="space-y-3"
        aria-labelledby="customer-members"
        data-testid="customer-members-section"
      >
        <header className="flex items-center justify-between">
          <h2 id="customer-members" className="text-base font-semibold">
            Members ({members.length})
          </h2>
          <PlatformInviteUserModal companyId={company.id} />
        </header>
        <DataTable
          data={members}
          columns={MEMBER_COLUMNS}
          rowKey={(m) => m.user_id}
          testId="customer-members-table"
          emptyState={{
            icon: <NavIcon name="users" size={20} />,
            iconLabel: "No members",
            title: "No members yet",
            body: (
              <>
                Click <strong>Invite user</strong> to send the first
                invitation.
              </>
            ),
          }}
        />
      </section>

      <section
        className="space-y-3"
        aria-labelledby="customer-pending"
        data-testid="customer-pending-section"
      >
        <header>
          <h2 id="customer-pending" className="text-base font-semibold">
            Pending invitations ({pending_invitations.length})
          </h2>
        </header>
        <DataTable
          data={pending_invitations}
          columns={PENDING_COLUMNS}
          rowKey={(i) => i.id}
          testId="customer-pending-table"
          emptyState={{
            icon: <NavIcon name="envelope" size={20} />,
            iconLabel: "No pending invitations",
            title: "No pending invitations",
            body: <>Invites you send will show up here until they&apos;re accepted.</>,
          }}
        />
      </section>
    </div>
  );
}
