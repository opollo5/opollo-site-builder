import { notFound, redirect } from "next/navigation";

import { AdminClientDrilldown } from "@/components/admin-insights/AdminClientDrilldown";
import { createRouteAuthClient } from "@/lib/auth";
import { getAdminClientSnapshot } from "@/lib/insights/admin-dashboard";
import { writeAdminAudit } from "@/lib/insights/admin-audit";
import { getInsightsDashboardData } from "@/lib/insights/dashboard";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function AdminClientInsightsPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createRouteAuthClient();
  const { data: isOp } = await supabase.rpc("is_cap_operator");
  if (!isOp) redirect("/admin");

  const { data: userResp } = await supabase.auth.getUser();
  const userId = userResp?.user?.id;

  const [snapshot, dashboardData] = await Promise.all([
    getAdminClientSnapshot(params.id),
    getInsightsDashboardData(params.id),
  ]);

  if (!snapshot) notFound();

  // Write view audit (non-mutating — best effort)
  if (userId) {
    await writeAdminAudit(
      {
        operatorUserId: userId,
        clientCompanyId: params.id,
        action: "view",
        actionDetails: {},
      },
      false,
    );
  }

  return (
    <AdminClientDrilldown
      clientName={snapshot.name}
      companyId={params.id}
      data={dashboardData}
    />
  );
}
