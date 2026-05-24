import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { AdminClientRow } from "@/lib/insights/admin-dashboard";
import { HealthBadge } from "./HealthBadge";
import { Sparkline } from "./Sparkline";

interface AdminClientRowItemProps {
  row: AdminClientRow;
}

export function AdminClientRowItem({ row }: AdminClientRowItemProps) {
  return (
    <div
      className="grid grid-cols-[1fr_120px_120px_100px_80px_auto] items-center gap-4 py-3 border-b border-b1 last:border-0"
      data-testid={`client-row-${row.companyId}`}
    >
      <div>
        <div className="font-medium text-tx-primary">{row.name}</div>
      </div>
      <div className="text-sm text-tx-muted">{row.lastPostRelative}</div>
      <div>
        <Sparkline data={row.trendData30d} />
      </div>
      <div>
        <HealthBadge status={row.healthStatus} />
      </div>
      <div className="text-sm text-tx-secondary tabular-nums">
        {row.openRecs}/{row.dismissedRecs}
      </div>
      <div>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/admin/insights/clients/${row.companyId}`}>→</Link>
        </Button>
      </div>
    </div>
  );
}
