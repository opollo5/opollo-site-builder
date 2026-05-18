"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { BillingIssueDialog } from "./BillingIssueDialog";
import type { ServiceSummary, ServiceStatus } from "@/lib/platform/service-health/status";
export { MONITORED_SERVICES } from "@/lib/platform/service-health/status";

const STATUS_COLORS: Record<ServiceStatus, string> = {
  green: "border-green-200 bg-green-50",
  yellow: "border-yellow-200 bg-yellow-50",
  red: "border-red-200 bg-red-50",
};

const STATUS_DOT: Record<ServiceStatus, string> = {
  green: "bg-green-500",
  yellow: "bg-yellow-500",
  red: "bg-red-500",
};

const STATUS_LABEL: Record<ServiceStatus, string> = {
  green: "Operational",
  yellow: "Degraded",
  red: "Down",
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface Props {
  services: ServiceSummary[];
}

export function ServiceStatusGrid({ services }: Props) {
  const router = useRouter();
  const [dialogService, setDialogService] = useState<string | null>(null);

  return (
    <>
      <div
        data-testid="service-status-grid"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
      >
        {services.map((svc) => (
          <div
            key={svc.name}
            className={`flex flex-col gap-2 rounded-lg border p-3 ${STATUS_COLORS[svc.status]}`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${STATUS_DOT[svc.status]}`}
                aria-hidden="true"
              />
              <span className="truncate text-sm font-medium">{svc.name}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {STATUS_LABEL[svc.status]}
              {svc.lastIncidentAt && (
                <> &middot; {relativeTime(svc.lastIncidentAt)}</>
              )}
            </div>
            <button
              type="button"
              className="mt-auto self-start rounded border border-border bg-background px-2 py-0.5 text-xs hover:bg-muted"
              onClick={() => setDialogService(svc.name)}
            >
              Flag for review
            </button>
          </div>
        ))}
      </div>

      {dialogService && (
        <BillingIssueDialog
          defaultService={dialogService}
          onClose={() => setDialogService(null)}
          onSuccess={() => {
            setDialogService(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
