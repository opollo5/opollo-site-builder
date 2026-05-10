import { notFound } from "next/navigation";

import { AdminProfileAnalyticsClient } from "@/components/AdminProfileAnalyticsClient";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { getPlatformCompany } from "@/lib/platform/companies";
import { getProfileAnalyticsDashboard } from "@/lib/platform/social/analytics-ingest";
import { getProfileById } from "@/lib/platform/social/profiles";

// BSP analytics — per-profile dashboard.
//
// Server-rendered. Loads the profile + initial 30-day dashboard.
// Date-range switching + refresh happen client-side in the
// AdminProfileAnalyticsClient component.
//
// Cross-tenant guard: surface 404 when the profile doesn't belong to
// the company in the URL. The page itself is gated by the admin layout
// (operator role only).

export const dynamic = "force-dynamic";

export default async function ProfileAnalyticsPage({
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
      <PageShell>
        <PageHeader>
          <PageHeader.Title>Failed to load company</PageHeader.Title>
        </PageHeader>
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
          role="alert"
        >
          {companyResult.error.message}
        </div>
      </PageShell>
    );
  }
  if (!profile) notFound();
  if (profile.company_id !== params.id) notFound();

  const { company } = companyResult.data;

  const initialDashboard = await getProfileAnalyticsDashboard({
    profileId: profile.id,
    rangeDays: 30,
  });

  return (
    <PageShell>
      <PageHeader>
        <PageHeader.Breadcrumb
          segments={[
            { label: "Admin", href: "/admin/sites" },
            { label: "Companies", href: "/admin/companies" },
            { label: company.name, href: `/admin/companies/${company.id}` },
            {
              label: "Social profiles",
              href: `/admin/companies/${company.id}/social-profiles`,
            },
            { label: profile.name },
            { label: "Analytics" },
          ]}
        />
        <PageHeader.Title>{profile.name} — analytics</PageHeader.Title>
        <PageHeader.Meta>
          <span className="text-muted-foreground">
            bundle.social-sourced engagement metrics
          </span>
        </PageHeader.Meta>
      </PageHeader>
      <AdminProfileAnalyticsClient
        companyId={company.id}
        profileId={profile.id}
        profileName={profile.name}
        initialDashboard={initialDashboard}
      />
    </PageShell>
  );
}
