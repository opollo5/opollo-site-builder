import { redirect } from "next/navigation";

import { AdminRoster } from "@/components/admin-insights/AdminRoster";
import { PortfolioKPIs } from "@/components/admin-insights/PortfolioKPIs";
import { RecentAdminActivity } from "@/components/admin-insights/RecentAdminActivity";
import { StaleDataAlerts } from "@/components/admin-insights/StaleDataAlerts";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { createRouteAuthClient } from "@/lib/auth";
import {
  getAdminPortfolioKpis,
  getAdminRoster,
  getRecentAdminActivity,
} from "@/lib/insights/admin-dashboard";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function AdminInsightsPage() {
  // Additional gate: requires is_cap_operator (admin layout already requires admin role)
  const supabase = createRouteAuthClient();
  const { data: isOp } = await supabase.rpc("is_cap_operator");
  if (!isOp) redirect("/admin");

  const [roster, activity] = await Promise.all([
    getAdminRoster(),
    getRecentAdminActivity(10),
  ]);

  const kpis = await getAdminPortfolioKpis(roster);
  const staleClients = roster.filter((r) => r.healthStatus === "red" || r.healthStatus === "amber");

  const breadcrumb = [
    { label: "Admin", href: "/admin" },
    { label: "Insights" },
  ];

  return (
    <PageShell>
      <PageHeader>
        <PageHeader.Breadcrumb segments={breadcrumb} />
        <PageHeader.Title>Insights · Admin</PageHeader.Title>
        <PageHeader.Subtitle>Performance across all managed clients</PageHeader.Subtitle>
        <PageHeader.Actions>
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/insights/compare">Compare</Link>
          </Button>
        </PageHeader.Actions>
      </PageHeader>

      <PageShell.Content>
        {staleClients.length > 0 && <StaleDataAlerts clients={staleClients} />}

        <PortfolioKPIs kpis={kpis} />

        <AdminRoster roster={roster} />

        <RecentAdminActivity activity={activity} />
      </PageShell.Content>
    </PageShell>
  );
}
