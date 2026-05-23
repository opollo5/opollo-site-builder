"use client";

import { AdminBanner } from "./AdminBanner";
import { InsightsDashboardClient } from "@/components/insights/InsightsDashboardClient";
import type { InsightsDashboardData } from "@/lib/insights/dashboard";

interface AdminClientDrilldownProps {
  clientName: string;
  companyId: string;
  data: InsightsDashboardData;
}

export function AdminClientDrilldown({
  clientName,
  companyId,
  data,
}: AdminClientDrilldownProps) {
  return (
    <div>
      <AdminBanner clientName={clientName} companyId={companyId} />
      <div className="px-6 py-8">
        <InsightsDashboardClient data={data} companyId={companyId} isAdminView />
      </div>
    </div>
  );
}
