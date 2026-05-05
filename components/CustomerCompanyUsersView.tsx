import { PlatformInviteUserModal } from "@/components/PlatformInviteUserModal";
import { PlatformRevokeInvitationButton } from "@/components/PlatformRevokeInvitationButton";
import { H1, Lead } from "@/components/ui/typography";
import type { CompanyDetail } from "@/lib/platform/companies";

// P4 — Customer admin's view of their own company's users. Tailored
// twin of PlatformCompanyDetail (operator-side P3-3) — same data, but
// no "Back to companies" link, no "Opollo internal" badge, and the
// page heading reads as "Users — {company.name}" rather than the
// company name itself.
//
// Reuses the operator-side invite modal + revoke button verbatim. They
// post to the same /api/platform/invitations routes; route gates allow
// admins of the matching company through the same canDo path.

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
        className="rounded-lg border bg-card"
        aria-labelledby="customer-members"
        data-testid="customer-members-section"
      >
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h2 id="customer-members" className="text-base font-semibold">
            Members ({members.length})
          </h2>
          <PlatformInviteUserModal companyId={company.id} />
        </header>
        {members.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No members yet — click <strong>Invite user</strong> to send the
            first invitation.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-left text-sm uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr
                  key={m.user_id}
                  className="border-b last:border-b-0"
                  data-testid={`customer-member-row-${m.user_id}`}
                >
                  <td className="px-4 py-3">{m.full_name ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-sm text-muted-foreground">
                    {m.email}
                  </td>
                  <td className="px-4 py-3 capitalize">{m.role}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {formatDate(m.joined_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section
        className="rounded-lg border bg-card"
        aria-labelledby="customer-pending"
        data-testid="customer-pending-section"
      >
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h2 id="customer-pending" className="text-base font-semibold">
            Pending invitations ({pending_invitations.length})
          </h2>
        </header>
        {pending_invitations.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No pending invitations.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-left text-sm uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Sent</th>
                <th className="px-4 py-2 font-medium">Expires</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pending_invitations.map((inv) => (
                <tr
                  key={inv.id}
                  className="border-b last:border-b-0"
                  data-testid={`customer-invitation-row-${inv.id}`}
                >
                  <td className="px-4 py-3 font-mono text-sm">{inv.email}</td>
                  <td className="px-4 py-3 capitalize">{inv.role}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {formatDate(inv.created_at)}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {formatDate(inv.expires_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <PlatformRevokeInvitationButton
                      invitationId={inv.id}
                      email={inv.email}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
