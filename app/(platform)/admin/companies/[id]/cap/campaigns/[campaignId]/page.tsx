import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { CapCampaignDetail } from "@/components/CapCampaignDetail";
import { getPlatformCompany } from "@/lib/platform/companies";
import { getCampaign, listPostsForCampaign } from "@/lib/cap/campaigns";

export const dynamic = "force-dynamic";

export default async function CapCampaignDetailPage({
  params,
}: {
  params: { id: string; campaignId: string };
}) {
  const [result, campaign] = await Promise.all([
    getPlatformCompany(params.id),
    getCampaign(params.campaignId),
  ]);

  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <PageShell>
        <PageHeader>
          <PageHeader.Breadcrumb segments={[{ label: "Error" }]} />
          <PageHeader.Title>Failed to load company</PageHeader.Title>
        </PageHeader>
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" role="alert">
          {result.error.message}
        </div>
      </PageShell>
    );
  }

  if (!campaign) notFound();

  const { company } = result.data;
  const posts = await listPostsForCampaign(campaign.id);

  const monthLabel = new Date(campaign.month).toLocaleString("en-AU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <PageShell>
      <PageHeader>
        <PageHeader.Breadcrumb
          segments={[
            { label: "Admin", href: "/admin/sites" },
            { label: "Companies", href: "/admin/companies" },
            { label: company.name, href: `/admin/companies/${company.id}` },
            { label: "CAP", href: `/admin/companies/${company.id}/cap` },
            { label: "Campaigns", href: `/admin/companies/${company.id}/cap/campaigns` },
            { label: monthLabel },
          ]}
        />
        <PageHeader.Title>{monthLabel} Campaign</PageHeader.Title>
        <PageHeader.Meta>
          <span className="text-sm text-muted-foreground">{campaign.monthly_objective}</span>
        </PageHeader.Meta>
      </PageHeader>
      <CapCampaignDetail
        campaign={campaign}
        initialPosts={posts}
      />
    </PageShell>
  );
}
