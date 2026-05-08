"use client";

import Link from "next/link";
import { useState } from "react";
import { PlatformInviteUserModal } from "@/components/PlatformInviteUserModal";
import { PlatformRevokeInvitationButton } from "@/components/PlatformRevokeInvitationButton";
import { Button } from "@/components/ui/button";
import { NavIcon } from "@/components/ui/nav-icon";
import { cn } from "@/lib/utils";
import type { CompanyDetail, CompanyStats } from "@/lib/platform/companies";

// P3-3 — company detail. Tabs: Overview (default), Settings, Members.
// Overview shows quick stats cards + key sections for staff operators.
//
// PageHeader (H1 + slug/domain meta + Opollo-internal pill + breadcrumb
// nav) lives in app/admin/companies/[id]/page.tsx via Spec 04 migration.
// This component renders the staff-join section, tabs, and tab body only.

type Tab = "overview" | "settings" | "members";

export function PlatformCompanyDetail({
  detail,
  isOpolloStaff = false,
  isCurrentUserMember = false,
  joinAction = null,
}: {
  detail: CompanyDetail;
  isOpolloStaff?: boolean;
  isCurrentUserMember?: boolean;
  joinAction?: ((formData: FormData) => Promise<void>) | null;
}) {
  const { company, members, pending_invitations, stats } = detail;
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  return (
    <div className="space-y-6">
      {isOpolloStaff && (
        <section
          className="rounded-lg border border-border bg-muted/30 px-4 py-3"
          aria-label="Staff access"
          data-testid="staff-join-section"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Opollo staff access</p>
              <p className="text-sm text-muted-foreground">
                {isCurrentUserMember
                  ? "You are a member of this company. Go to the social platform to manage posts."
                  : "Join this company as admin to manage their social media posts."}
              </p>
            </div>
            {isCurrentUserMember ? (
              <Button asChild data-testid="staff-go-to-platform-link">
                <Link href="/company">Go to platform →</Link>
              </Button>
            ) : joinAction ? (
              <form action={joinAction}>
                <Button type="submit" data-testid="staff-join-button">
                  Join as admin
                </Button>
              </form>
            ) : null}
          </div>
        </section>
      )}

      {/* Tab navigation */}
      <nav
        role="tablist"
        aria-label="Company sections"
        className="flex gap-1 border-b"
      >
        {(["overview", "settings", "members"] as Tab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px",
              activeTab === tab
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab}
          </button>
        ))}
      </nav>

      {activeTab === "overview" && (
        <OverviewTab company={company} stats={stats} members={members} />
      )}

      {activeTab === "settings" && (
        <SettingsTab company={company} />
      )}

      {activeTab === "members" && (
        <MembersTab
          company={company}
          members={members}
          pending_invitations={pending_invitations}
        />
      )}
    </div>
  );
}

function OverviewTab({
  company,
  stats,
  members,
}: {
  company: CompanyDetail["company"];
  stats: CompanyStats;
  members: CompanyDetail["members"];
}) {
  return (
    <div className="space-y-6" data-testid="company-overview-tab">
      {/* Quick stats cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          iconName="users"
          label="Team members"
          value={stats.member_count}
          testId="stat-members"
        />
        <StatCard
          iconName="share2"
          label="Social accounts"
          value={stats.social_connection_count}
          testId="stat-connections"
        />
        <StatCard
          iconName="clock"
          label="Pending approval"
          value={stats.pending_post_count}
          testId="stat-pending"
        />
        <StatCard
          iconName="checkmark-circle"
          label="Approved posts"
          value={stats.approved_post_count}
          testId="stat-approved"
        />
        <StatCard
          iconName="paper-plane"
          label="Published posts"
          value={stats.published_post_count}
          testId="stat-published"
        />
      </div>

      {/* Team members preview */}
      <section className="rounded-lg border bg-card" aria-labelledby="overview-members">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h2 id="overview-members" className="text-base font-semibold">
            Team ({members.length})
          </h2>
          <PlatformInviteUserModal companyId={company.id} />
        </header>
        {members.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No members yet — invite someone to get started.
          </div>
        ) : (
          <div className="divide-y">
            {members.slice(0, 5).map((m) => (
              <div key={m.user_id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <div>
                  <p className="font-medium">{m.full_name ?? m.email}</p>
                  {m.full_name && (
                    <p className="text-muted-foreground">{m.email}</p>
                  )}
                </div>
                <span className="capitalize text-muted-foreground">{m.role}</span>
              </div>
            ))}
            {members.length > 5 && (
              <div className="px-4 py-2.5 text-sm text-muted-foreground">
                +{members.length - 5} more members
              </div>
            )}
          </div>
        )}
      </section>

      {/* Social platform link */}
      <section className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Social platform</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Manage posts, connections, and scheduling for this company.
            </p>
          </div>
          <Button asChild variant="secondary">
            <Link href="/company">Open platform →</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}

function StatCard({
  iconName,
  label,
  value,
  testId,
}: {
  iconName: string;
  label: string;
  value: number;
  testId?: string;
}) {
  return (
    <div
      className="rounded-lg border bg-card p-4"
      data-testid={testId}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <NavIcon name={iconName} size={16} />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function SettingsTab({ company }: { company: CompanyDetail["company"] }) {
  return (
    <section
      className="rounded-lg border bg-card"
      aria-labelledby="company-meta"
      data-testid="company-settings-tab"
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
          <dd className="font-mono">{company.slug}</dd>
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
  );
}

function MembersTab({
  company,
  members,
  pending_invitations,
}: {
  company: CompanyDetail["company"];
  members: CompanyDetail["members"];
  pending_invitations: CompanyDetail["pending_invitations"];
}) {
  return (
    <div className="space-y-6" data-testid="company-members-tab">
      <section
        className="rounded-lg border bg-card"
        aria-labelledby="company-members"
        data-testid="company-members-section"
      >
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h2 id="company-members" className="text-base font-semibold">
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
                <th className="px-4 py-2 text-right font-medium">Actions</th>
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
