import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { CapAnalyticsDashboard } from "@/components/CapAnalyticsDashboard";
import { getPlatformCompany } from "@/lib/platform/companies";
import { getCapSubscriptionByCompany } from "@/lib/cap/subscriptions";
import { getCapAnalyticsSummary } from "@/lib/cap/analytics";

export const dynamic = "force-dynamic";

export default async function CapAnalyticsPage({
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
          <PageHeader.Breadcrumb segments={[{ label: "Error" }]} />
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
  const analytics = subscription ? await getCapAnalyticsSummary(subscription.id) : null;

  return (
    <PageShell>
      <PageHeader>
        <PageHeader.Breadcrumb
          segments={[
            { label: "Admin", href: "/admin/sites" },
            { label: "Companies", href: "/admin/companies" },
            { label: company.name, href: `/admin/companies/${company.id}` },
            { label: "CAP", href: `/admin/companies/${company.id}/cap` },
            { label: "Analytics" },
          ]}
        />
        <PageHeader.Title>CAP Analytics — {company.name}</PageHeader.Title>
      </PageHeader>
      {!subscription || !analytics ? (
        <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
          {!subscription
            ? "CAP is not enabled for this company."
            : "No analytics data available yet."}
        </div>
      ) : (
        <CapAnalyticsDashboard analytics={analytics} />
      )}
    </PageShell>
  );
}
