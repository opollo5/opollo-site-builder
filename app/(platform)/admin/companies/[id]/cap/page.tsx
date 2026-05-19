import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { CapSubscriptionPanel } from "@/components/CapSubscriptionPanel";
import { getPlatformCompany } from "@/lib/platform/companies";
import { getCapSubscriptionByCompany } from "@/lib/cap/subscriptions";
import { listVoiceProfiles } from "@/lib/cap/voice-profiles";

export const dynamic = "force-dynamic";

export default async function CompanyCapPage({
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
  const subscription = await getCapSubscriptionByCompany(company.id);
  const voiceProfiles = subscription ? await listVoiceProfiles(subscription.id) : [];

  return (
    <PageShell>
      <PageHeader>
        <PageHeader.Breadcrumb
          segments={[
            { label: "Admin", href: "/admin/sites" },
            { label: "Companies", href: "/admin/companies" },
            { label: company.name, href: `/admin/companies/${company.id}` },
            { label: "CAP" },
          ]}
        />
        <PageHeader.Title>Content Automation — {company.name}</PageHeader.Title>
        <PageHeader.Meta>
          <span className="font-mono">{company.slug}</span>
        </PageHeader.Meta>
      </PageHeader>
      <CapSubscriptionPanel
        companyId={company.id}
        initialSubscription={subscription}
        initialVoiceProfiles={voiceProfiles}
      />
    </PageShell>
  );
}
