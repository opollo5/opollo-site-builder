import type { ServiceHealthEvent } from "./types";

export const MONITORED_SERVICES = [
  "bundle.social",
  "ideogram",
  "sendgrid",
  "anthropic",
  "supabase",
  "upstash-redis",
  "vercel-cron",
] as const;

export type MonitoredService = (typeof MONITORED_SERVICES)[number];
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
