import { notFound } from "next/navigation";

import { AdminSocialProfilesList } from "@/components/AdminSocialProfilesList";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { getPlatformCompany } from "@/lib/platform/companies";
import { listProfilesForCompany } from "@/lib/platform/social/profiles";

// BSP-5 — Opollo admin social-profiles management.
//
// Server-rendered. Loads the company + its profiles. The admin layout
// already gates on operator role; we don't double-gate here.
//
// Per-row actions (rename, set default, delete) and the create form
// live in the client component.

export const dynamic = "force-dynamic";

export default async function SocialProfilesPage({
  params,
}: {
  params: { id: string };
}) {
  const result = await getPlatformCompany(params.id);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <PageShell>
        <PageHeader>
          <PageHeader.Breadcrumb
            segments={[
              { label: "Admin", href: "/admin/sites" },
              { label: "Companies", href: "/admin/companies" },
              { label: "Error" },
            ]}
          />
          <PageHeader.Title>Failed to load company</PageHeader.Title>
        </PageHeader>
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
          role="alert"
        >
          {result.error.message}
        </div>
      </PageShell>
    );
  }

  const { company } = result.data;
  const profiles = await listProfilesForCompany(company.id);

  return (
    <PageShell>
      <PageHeader>
        <PageHeader.Breadcrumb
          segments={[
            { label: "Admin", href: "/admin/sites" },
            { label: "Companies", href: "/admin/companies" },
            { label: company.name, href: `/admin/companies/${company.id}` },
            { label: "Social profiles" },
          ]}
        />
        <PageHeader.Title>Social profiles — {company.name}</PageHeader.Title>
        <PageHeader.Meta>
          <span className="font-mono" data-testid="company-detail-slug">
            {company.slug}
          </span>
        </PageHeader.Meta>
      </PageHeader>
      <AdminSocialProfilesList
        companyId={company.id}
        initialProfiles={profiles}
      />
    </PageShell>
  );
}
