import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { CapCampaignList } from "@/components/CapCampaignList";
import { getPlatformCompany } from "@/lib/platform/companies";
import { getCapSubscriptionByCompany } from "@/lib/cap/subscriptions";
import { listCampaignsForSubscription } from "@/lib/cap/campaigns";

export const dynamic = "force-dynamic";

export default async function CapCampaignsPage({
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
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" role="alert">
          {result.error.message}
        </div>
      </PageShell>
    );
  }

  const { company } = result.data;
  const subscription = await getCapSubscriptionByCompany(company.id);
  const campaigns = subscription ? await listCampaignsForSubscription(subscription.id) : [];

  return (
    <PageShell>
      <PageHeader>
        <PageHeader.Breadcrumb
          segments={[
            { label: "Admin", href: "/admin/sites" },
            { label: "Companies", href: "/admin/companies" },
            { label: company.name, href: `/admin/companies/${company.id}` },
            { label: "CAP", href: `/admin/companies/${company.id}/cap` },
            { label: "Campaigns" },
          ]}
        />
        <PageHeader.Title>Campaigns — {company.name}</PageHeader.Title>
      </PageHeader>
      {!subscription ? (
        <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
          CAP is not enabled for this company.{" "}
          <a href={`/admin/companies/${company.id}/cap`} className="underline">Enable it here.</a>
        </div>
      ) : (
        <CapCampaignList
          companyId={company.id}
          subscriptionId={subscription.id}
          initialCampaigns={campaigns}
        />
      )}
    </PageShell>
  );
}
