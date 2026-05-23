import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import type { AdminClientRow } from "@/lib/insights/admin-dashboard";

interface StaleDataAlertsProps {
  clients: AdminClientRow[];
}

export function StaleDataAlerts({ clients }: StaleDataAlertsProps) {
  if (clients.length === 0) return null;

  return (
    <Alert
      variant="warning"
      title={`${clients.length} ${clients.length === 1 ? "client needs" : "clients need"} attention`}
      data-testid="stale-data-alerts"
    >
      <ul className="mt-2 space-y-1 text-sm">
        {clients.slice(0, 5).map((c) => (
          <li key={c.companyId}>
            •{" "}
            <Link
              href={`/admin/insights/clients/${c.companyId}`}
              className="underline hover:text-tx-primary"
            >
              {c.name}
            </Link>
            {" "}— last post {c.lastPostRelative}
          </li>
        ))}
        {clients.length > 5 && (
          <li className="text-tx-muted">…and {clients.length - 5} more</li>
        )}
      </ul>
    </Alert>
  );
}
