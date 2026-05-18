"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { BillingIssueDialog } from "./BillingIssueDialog";
import type { ServiceHealthEvent } from "@/lib/platform/service-health/types";

export const MONITORED_SERVICES = [
  "bundle.social",
  "ideogram",
  "sendgrid",
  "anthropic",
  "supabase",
  "upstash-redis",
  "vercel-cron",
] as const;

export type ServiceStatus = "green" | "yellow" | "red";

export interface ServiceSummary {
  name: string;
  status: ServiceStatus;
  lastIncidentAt: string | null;
}

/** Derive per-service status from the event list. */
export function computeServiceStatuses(
  events: ServiceHealthEvent[],
): ServiceSummary[] {
  const now = Date.now();
  const h24 = now - 24 * 60 * 60 * 1000;
  const h6 = now - 6 * 60 * 60 * 1000;

  return MONITORED_SERVICES.map((name) => {
    const svcEvents = events.filter((e) => e.service_name === name);

    const unresolvedCritical = svcEvents.find(
      (e) =>
        e.severity === "critical" &&
        e.resolved_at === null &&
        new Date(e.last_seen_at).getTime() > h24,
    );

    const recentlyResolvedCritical = svcEvents.find(
      (e) =>
        e.severity === "critical" &&
        e.resolved_at !== null &&
        new Date(e.resolved_at).getTime() > h6,
    );

    const hasWarnings = svcEvents.some(
      (e) =>
        e.severity === "warning" &&
        e.resolved_at === null &&
        new Date(e.last_seen_at).getTime() > h24,
    );

    let status: ServiceStatus = "green";
    if (unresolvedCritical) status = "red";
    else if (recentlyResolvedCritical || hasWarnings) status = "yellow";

    const relevantEvents = svcEvents.filter(
      (e) => e.event_type !== "recovered",
    );
    const lastIncidentAt =
      relevantEvents.length > 0
        ? relevantEvents.reduce((a, b) =>
            a.last_seen_at > b.last_seen_at ? a : b,
          ).last_seen_at
        : null;

    return { name, status, lastIncidentAt };
  });
}

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
