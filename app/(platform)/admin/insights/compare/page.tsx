import { redirect } from "next/navigation";

import { ClientCompareCharts } from "@/components/admin-insights/ClientCompareCharts";
import { ClientCompareTable } from "@/components/admin-insights/ClientCompareTable";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { createRouteAuthClient } from "@/lib/auth";
import { getAdminRoster, getCompareData } from "@/lib/insights/admin-dashboard";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function AdminInsightsComparePage({
  searchParams,
}: {
  searchParams?: { ids?: string };
}) {
  const supabase = createRouteAuthClient();
  const { data: isOp } = await supabase.rpc("is_cap_operator");
  if (!isOp) redirect("/admin");

  const roster = await getAdminRoster();
  const selectedIds = searchParams?.ids?.split(",").filter(Boolean) ?? [];
  const compareData = selectedIds.length > 0 ? await getCompareData(selectedIds) : [];

  const breadcrumb = [
    { label: "Admin", href: "/admin" },
    { label: "Insights", href: "/admin/insights" },
    { label: "Compare" },
  ];

  return (
    <PageShell>
      <PageHeader>
        <PageHeader.Breadcrumb segments={breadcrumb} />
        <PageHeader.Title>Compare clients</PageHeader.Title>
        <PageHeader.Subtitle>Side-by-side engagement performance</PageHeader.Subtitle>
        <PageHeader.Actions>
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/insights">← Back to roster</Link>
          </Button>
        </PageHeader.Actions>
      </PageHeader>

      <PageShell.Content>
        <ClientCompareTable roster={roster} selectedIds={selectedIds} compareData={compareData} />
        {compareData.length > 0 && <ClientCompareCharts data={compareData} />}
      </PageShell.Content>
    </PageShell>
  );
}
