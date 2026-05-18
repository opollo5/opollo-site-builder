import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { checkAdminAccess } from "@/lib/admin-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { ServiceStatusGrid } from "@/components/admin/health/ServiceStatusGrid";
import { EventTimeline } from "@/components/admin/health/EventTimeline";
import { computeServiceStatuses } from "@/lib/platform/service-health/status";
import type { ServiceHealthEvent } from "@/lib/platform/service-health/types";

export const dynamic = "force-dynamic";

async function fetchEvents(): Promise<ServiceHealthEvent[]> {
  const svc = getServiceRoleClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await svc
    .from("service_health_events")
    .select("*")
    .gte("last_seen_at", since)
    .order("last_seen_at", { ascending: false })
    .limit(500);

  return (data ?? []) as ServiceHealthEvent[];
}

function buildDigestPreview(events: ServiceHealthEvent[]): string {
  const since24h = Date.now() - 24 * 60 * 60 * 1000;
  const recent = events.filter(
    (e) => new Date(e.last_seen_at).getTime() > since24h,
  );
  if (recent.length === 0) return "All services healthy in the last 24 hours.";

  const byService: Record<string, ServiceHealthEvent[]> = {};
  for (const e of recent) {
    (byService[e.service_name] ??= []).push(e);
  }

  return Object.entries(byService)
    .map(([svc, evts]) => {
      const critical = evts.filter((e) => e.severity === "critical").length;
      const warning = evts.filter((e) => e.severity === "warning").length;
      const parts: string[] = [];
      if (critical) parts.push(`${critical} critical`);
      if (warning) parts.push(`${warning} warning`);
      return `${svc}: ${parts.join(", ")}`;
    })
    .join("\n");
}

export default async function ServiceHealthPage() {
  const access = await checkAdminAccess({
    requiredRoles: ["super_admin"],
    insufficientRoleRedirectTo: "/",
  });
  if (access.kind === "redirect") redirect(access.to);

  const events = await fetchEvents();
  const services = computeServiceStatuses(events);
  const digestPreview = buildDigestPreview(events);

  const criticalCount = services.filter((s) => s.status === "red").length;
  const degradedCount = services.filter((s) => s.status === "yellow").length;

  return (
    <PageShell>
      <PageHeader>
        <PageHeader.Breadcrumb
          segments={[
            { label: "Admin", href: "/admin/sites" },
            { label: "System", href: "/admin/system/jobs" },
            { label: "Service health" },
          ]}
        />
        <PageHeader.Title>Service health</PageHeader.Title>
        <PageHeader.Subtitle>
          Live status of external services. Events are aggregated over 5-minute
          windows. Refresh to re-read.
        </PageHeader.Subtitle>
      </PageHeader>

      {criticalCount > 0 && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <strong>{criticalCount} service{criticalCount > 1 ? "s" : ""} down</strong>{" "}
          — platform admins have been notified. See event timeline below.
        </div>
      )}

      {criticalCount === 0 && degradedCount > 0 && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning"
        >
          <strong>{degradedCount} service{degradedCount > 1 ? "s" : ""} degraded</strong>{" "}
          — warning events active. Monitor closely.
        </div>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Service status
        </h2>
        <div className="mt-3">
          <ServiceStatusGrid services={services} />
        </div>
      </section>

      <div className="mt-8 flex flex-col gap-6 lg:flex-row">
        <section className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Event timeline
            <span className="ml-2 font-normal normal-case text-muted-foreground">
              (last 30 days)
            </span>
          </h2>
          <div className="mt-3">
            <EventTimeline initialEvents={events} />
          </div>
        </section>

        <aside className="w-full lg:w-72 xl:w-80">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Tomorrow&apos;s digest preview
          </h2>
          <div className="mt-3 rounded-md border bg-muted/30 p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Based on the last 24 hours:
            </p>
            <pre className="whitespace-pre-wrap text-xs">{digestPreview}</pre>
          </div>
        </aside>
      </div>
    </PageShell>
  );
}
