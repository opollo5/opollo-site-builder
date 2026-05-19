import { notFound } from "next/navigation";

import { AdminProfileConnectionsList } from "@/components/AdminProfileConnectionsList";
import { TDetailSummary } from "@/templates";
import { getPlatformCompany } from "@/lib/platform/companies";
import { getProfileById } from "@/lib/platform/social/profiles";
import { readProfileTeamAccounts } from "@/lib/platform/social/profiles/connect";

// BSP-6 — per-profile connections page.
//
// Server-rendered. Loads the profile + its bundle.social team accounts
// (if a team has been provisioned). Lazily provisions on first
// "Connect" click in the client component.
//
// Auth: app/(platform)/admin/layout.tsx already gates on operator
// role; we additionally verify the profile belongs to the company in
// the URL path so cross-company URLs surface as 404, not as silent
// access to another tenant's profile.

export const dynamic = "force-dynamic";

export default async function ProfileConnectionsPage({
  params,
}: {
  params: { id: string; profileId: string };
}) {
  const [companyResult, profile] = await Promise.all([
    getPlatformCompany(params.id),
    getProfileById(params.profileId),
  ]);

  if (!companyResult.ok) {
    if (companyResult.error.code === "NOT_FOUND") notFound();
    return (
      <TDetailSummary
        title="Failed to load company"
        sections={[{
          content: (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
              role="alert"
            >
              {companyResult.error.message}
            </div>
          ),
        }]}
      />
    );
  }
  if (!profile) notFound();
  if (profile.company_id !== params.id) notFound();

  const { company } = companyResult.data;

  // Lazy team-detail read — only call bundle.social if a team has been
  // provisioned. Initial state for unprovisioned profiles is empty.
  let initialAccounts: Array<{
    id: string;
    type: string;
    username: string | null;
    displayName: string | null;
  }> = [];
  let teamReadError: string | null = null;
  if (profile.bundle_social_team_id) {
    const teamResult = await readProfileTeamAccounts({
      teamId: profile.bundle_social_team_id,
    });
    if (teamResult.ok) {
      initialAccounts = teamResult.data.accounts;
    } else {
      teamReadError = teamResult.error.message;
    }
  }

  return (
    <TDetailSummary
      title={`${profile.name} — connections`}
      breadcrumb={[
        { label: "Admin", href: "/admin/sites" },
        { label: "Companies", href: "/admin/companies" },
        { label: company.name, href: `/admin/companies/${company.id}` },
        {
          label: "Social profiles",
          href: `/admin/companies/${company.id}/social-profiles`,
        },
        { label: profile.name },
      ]}
      meta={
        profile.bundle_social_team_id ? (
          <span className="font-mono" data-testid="profile-team-id">
            team {profile.bundle_social_team_id}
          </span>
        ) : (
          <span className="italic text-muted-foreground">
            team not yet provisioned
          </span>
        )
      }
      sections={[{
        content: (
          <AdminProfileConnectionsList
            companyId={company.id}
            profileId={profile.id}
            profileName={profile.name}
            initialAccounts={initialAccounts}
            initialTeamReadError={teamReadError}
          />
        ),
      }]}
    />
  );
}
