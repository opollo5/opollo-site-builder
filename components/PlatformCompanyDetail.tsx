import Link from "next/link";

import { H1, Lead } from "@/components/ui/typography";
import type { CompanyDetail } from "@/lib/platform/companies";

// P3-3 — read-only company detail. Renders company metadata, the list
// of members with their role, and any pending invitations. Action
// buttons (invite, revoke) land in P3-4.

export function PlatformCompanyDetail({ detail }: { detail: CompanyDetail }) {
  const { company, members, pending_invitations } = detail;

  return (
    <div className="space-y-8">
      <header>
        <Link
          href="/admin/companies"
          className="text-sm text-muted-foreground hover:underline"
          data-testid="company-detail-back"
        >
          ← Back to companies
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <H1>{company.name}</H1>
          {company.is_opollo_internal ? (
            <span
              className="rounded-full bg-primary/10 px-2 py-0.5 text-sm font-medium text-primary"
              data-testid="company-internal-badge"
            >
              Opollo internal
            </span>
          ) : null}
        </div>
        <Lead className="mt-1">
          {company.domain ? (
            <span className="font-mono text-sm">{company.domain}</span>
          ) : (
            <span className="text-muted-foreground">No domain set</span>
          )}
        </Lead>
      </header>

      <section
        className="rounded-lg border bg-card"
        aria-labelledby="company-meta"
      >
        <h2
          id="company-meta"
          className="border-b px-4 py-3 text-base font-semibold"
        >
          Company settings
        </h2>
        <dl className="grid grid-cols-1 gap-3 p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Slug</dt>
            <dd
              className="font-mono"
              data-testid="company-detail-slug"
            >
              {company.slug}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Timezone</dt>
            <dd>{company.timezone}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Approval required</dt>
            <dd>{company.approval_default_required ? "Yes" : "No"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Approval rule</dt>
            <dd>{company.approval_default_rule}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Concurrent publish limit</dt>
            <dd className="tabular-nums">
              {company.concurrent_publish_limit}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Created</dt>
            <dd>{formatDate(company.created_at)}</dd>
          </div>
        </dl>
      </section>

      <section
        className="rounded-lg border bg-card"
        aria-labelledby="company-members"
        data-testid="company-members-section"
      >
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h2 id="company-members" className="text-base font-semibold">
            Members ({members.length})
          </h2>
        </header>
        {members.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No members yet — send an invitation to get started (P3-4).
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
                  data-testid={`company-member-row-${m.user_id}`}
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
        aria-labelledby="company-pending"
        data-testid="company-pending-section"
      >
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h2 id="company-pending" className="text-base font-semibold">
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
              </tr>
            </thead>
            <tbody>
              {pending_invitations.map((inv) => (
                <tr
                  key={inv.id}
                  className="border-b last:border-b-0"
                  data-testid={`company-invitation-row-${inv.id}`}
                >
                  <td className="px-4 py-3 font-mono text-sm">{inv.email}</td>
                  <td className="px-4 py-3 capitalize">{inv.role}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {formatDate(inv.created_at)}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {formatDate(inv.expires_at)}
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
