import { redirect } from "next/navigation";
import { promises as fs } from "node:fs";
import path from "node:path";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import { H1, H2, Lead } from "@/components/ui/typography";
import { StatusPill } from "@/components/ui/status-pill";
import { checkAdminAccess } from "@/lib/admin-gate";
import { getServiceRoleClient } from "@/lib/supabase";

// /admin/system/jobs — cron + queue overview surface.
//
// UAT (2026-05-02) — Steven flagged that there's no in-app place to see
// which crons are configured, what their schedule is, and whether the
// queues they drive have any pending work. Until then the only options
// were Vercel Dashboard → Cron Jobs (schedule only) + raw SQL on the
// queue tables. This page bundles both into one super_admin surface.
//
// Render layers:
//   1. Cron schedule — read from vercel.json at build time, sorted by
//      "every minute → hourly → daily → weekly" cadence.
//   2. Queue depth — counts of pending / running / failed rows in the
//      five queue tables backing the worker crons (brief_runs,
//      generation_jobs, regeneration_jobs, transfer_jobs, batch_jobs).
//
// "Last run" timestamps for the crons themselves live in Vercel's logs
// API; we don't have a server-side cache of those yet. A future slice
// can wire that in. For now the queue counts surface "is anything
// stuck" which was Steven's primary use case.

export const dynamic = "force-dynamic";

interface CronEntry {
  path: string;
  schedule: string;
  cadence: string;
  description: string;
}

interface VercelJsonShape {
  crons?: Array<{ path: string; schedule: string }>;
}

const CRON_DESCRIPTIONS: Record<string, string> = {
  "/api/cron/process-batch":
    "Drives generation_jobs slots — leases the next pending slot, runs Anthropic + WP publish, advances or fails it.",
  "/api/cron/process-regenerations":
    "Drives regeneration_jobs — single-page re-renders triggered from the page detail surface.",
  "/api/cron/process-brief-runner":
    "Drives brief_runs — leases the next queued run and ticks one page worth of generation.",
  "/api/cron/budget-reset":
    "Zero-out daily / monthly cents on tenant_cost_budgets when their reset timestamps pass.",
  "/api/cron/optimiser-sync-ads": "Pull ad spend + impression data from Google Ads.",
  "/api/cron/optimiser-sync-clarity": "Pull session recordings / heatmap data from Microsoft Clarity.",
  "/api/cron/optimiser-sync-ga4": "Pull conversion + traffic data from GA4.",
  "/api/cron/optimiser-sync-pagespeed": "Pull Core Web Vitals from PageSpeed Insights.",
  "/api/cron/optimiser-evaluate-pages": "Score landing pages against the alignment matrix.",
  "/api/cron/optimiser-score-pages": "Compute the rolled-up health score per page.",
  "/api/cron/optimiser-email-digest": "Email the daily digest of new proposals + warnings.",
  "/api/cron/optimiser-expire-proposals": "Auto-expire stale proposals that the operator never actioned.",
  "/api/cron/optimiser-evaluate-scores": "Re-score landing pages after fresh metrics land.",
  "/api/cron/optimiser-evaluate-causal-deltas":
    "Compute causal deltas for proposals that have a control-vs-variant pair live.",
  "/api/cron/optimiser-monitor-rollouts": "Watch staged rollouts for regressions.",
  "/api/cron/optimiser-ab-monitor": "Watch live A/B tests for traffic / conversion drift.",
  "/api/cron/optimiser-assisted-approval":
    "Auto-approve proposals that meet pre-set thresholds.",
  "/api/cron/optimiser-extract-patterns": "Mine successful proposals for reusable patterns.",
  "/api/cron/optimiser-sync-vercel-logs":
    "Pull Vercel function-error logs to surface bad deploys earlier.",
};

function describeSchedule(schedule: string): string {
  if (schedule === "* * * * *") return "Every minute";
  if (/^0 \* \* \* \*$/.test(schedule)) return "Hourly (top of hour)";
  if (/^\d+ \* \* \* \*$/.test(schedule)) {
    const m = schedule.split(" ")[0];
    return `Hourly (at :${m.padStart(2, "0")})`;
  }
  if (/^0 \d+ \* \* \*$/.test(schedule)) {
    const h = schedule.split(" ")[1];
    return `Daily at ${h.padStart(2, "0")}:00 UTC`;
  }
  if (/^\d+ \d+ \* \* \*$/.test(schedule)) {
    const [m, h] = schedule.split(" ");
    return `Daily at ${h.padStart(2, "0")}:${m.padStart(2, "0")} UTC`;
  }
  if (/^\d+ \d+ \* \* \d+$/.test(schedule)) return `Weekly (${schedule})`;
  return schedule;
}

function cadenceRank(schedule: string): number {
  if (schedule === "* * * * *") return 0; // every minute
  if (/^\d+ \* \* \* \*$/.test(schedule)) return 1; // hourly
  if (/^\d+ \d+ \* \* \*$/.test(schedule)) return 2; // daily
  return 3; // weekly+
}

async function readCrons(): Promise<CronEntry[]> {
  // Read vercel.json at request time so the page reflects the deployed
  // schedule even if the build cache stale.
  try {
    const raw = await fs.readFile(
      path.join(process.cwd(), "vercel.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as VercelJsonShape;
    const crons = parsed.crons ?? [];
    return crons
      .map((c) => ({
        path: c.path,
        schedule: c.schedule,
        cadence: describeSchedule(c.schedule),
        description: CRON_DESCRIPTIONS[c.path] ?? "(no description recorded)",
      }))
      .sort((a, b) => {
        const r = cadenceRank(a.schedule) - cadenceRank(b.schedule);
        if (r !== 0) return r;
        return a.path.localeCompare(b.path);
      });
  } catch {
    return [];
  }
}

interface QueueStat {
  table: string;
  label: string;
  cron: string;
  pending: number;
  running: number;
  failed: number;
  oldestPendingAgeSec: number | null;
}

async function readQueueStats(): Promise<QueueStat[]> {
  const svc = getServiceRoleClient();
  const out: QueueStat[] = [];

  type QueueDef = {
    table: string;
    label: string;
    cron: string;
    statusCol: string;
    pendingValues: string[];
    runningValues: string[];
    failedValues: string[];
  };
  const defs: QueueDef[] = [
    {
      table: "brief_runs",
      label: "Brief runs",
      cron: "/api/cron/process-brief-runner",
      statusCol: "status",
      pendingValues: ["queued"],
      runningValues: ["running", "paused"],
      failedValues: ["failed"],
    },
    {
      table: "generation_jobs",
      label: "Generation batches",
      cron: "/api/cron/process-batch",
      statusCol: "status",
      pendingValues: ["queued"],
      runningValues: ["running"],
      failedValues: ["failed"],
    },
    {
      table: "regeneration_jobs",
      label: "Regeneration jobs",
      cron: "/api/cron/process-regenerations",
      statusCol: "status",
      pendingValues: ["pending"],
      runningValues: ["running"],
      failedValues: ["failed"],
    },
  ];

  for (const def of defs) {
    try {
      const [pendingRes, runningRes, failedRes, oldestRes] = await Promise.all([
        svc
          .from(def.table)
          .select("id", { count: "exact", head: true })
          .in(def.statusCol, def.pendingValues),
        svc
          .from(def.table)
          .select("id", { count: "exact", head: true })
          .in(def.statusCol, def.runningValues),
        svc
          .from(def.table)
          .select("id", { count: "exact", head: true })
          .in(def.statusCol, def.failedValues),
        svc
          .from(def.table)
          .select("created_at")
          .in(def.statusCol, def.pendingValues)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);
      const oldestAt = oldestRes.data?.created_at as string | undefined;
      out.push({
        table: def.table,
        label: def.label,
        cron: def.cron,
        pending: pendingRes.count ?? 0,
        running: runningRes.count ?? 0,
        failed: failedRes.count ?? 0,
        oldestPendingAgeSec: oldestAt
          ? Math.round((Date.now() - new Date(oldestAt).getTime()) / 1000)
          : null,
      });
    } catch {
      out.push({
        table: def.table,
        label: def.label,
        cron: def.cron,
        pending: -1,
        running: -1,
        failed: -1,
        oldestPendingAgeSec: null,
      });
    }
  }
  return out;
}

function ageString(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

export default async function SystemJobsPage() {
  const access = await checkAdminAccess({
    requiredRoles: ["super_admin"],
    insufficientRoleRedirectTo: "/",
  });
  if (access.kind === "redirect") redirect(access.to);

  const [crons, queues] = await Promise.all([readCrons(), readQueueStats()]);

  const stuckQueues = queues.filter(
    (q) =>
      (q.pending > 0 && (q.oldestPendingAgeSec ?? 0) > 120) ||
      q.failed > 0,
  );

  return (
    <div className="mx-auto max-w-5xl">
      <Breadcrumbs
        crumbs={[
          { label: "Admin", href: "/admin/sites" },
          { label: "System", href: "/admin/system/jobs" },
          { label: "Jobs" },
        ]}
      />
      <H1 className="mt-2">System jobs</H1>
      <Lead className="mt-1">
        Cron schedule + queue depth across the worker pipelines. Refresh the
        page to re-read; counts come straight from the queue tables.
      </Lead>

      {stuckQueues.length > 0 && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning"
        >
          <strong>Attention:</strong> {stuckQueues.length} queue
          {stuckQueues.length === 1 ? "" : "s"} {" "}
          look{stuckQueues.length === 1 ? "s" : ""} stuck — items pending more
          than 2 minutes or failed rows present. Check the table below.
        </div>
      )}

      <section className="mt-6">
        <H2>Queue depth</H2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pending = waiting for a worker. Running = leased and in flight. Failed
          = terminal failure (no further retries).
        </p>
        <div className="mt-3 overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Queue</th>
                <th className="px-3 py-2 font-medium">Cron</th>
                <th className="px-3 py-2 font-medium">Pending</th>
                <th className="px-3 py-2 font-medium">Running</th>
                <th className="px-3 py-2 font-medium">Failed</th>
                <th className="px-3 py-2 font-medium">Oldest pending</th>
              </tr>
            </thead>
            <tbody>
              {queues.map((q) => {
                const stuck =
                  q.pending > 0 && (q.oldestPendingAgeSec ?? 0) > 120;
                return (
                  <tr
                    key={q.table}
                    className="border-b last:border-b-0 hover:bg-muted/30"
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium">{q.label}</div>
                      <code className="text-xs text-muted-foreground">
                        {q.table}
                      </code>
                    </td>
                    <td className="px-3 py-2">
                      <code className="text-xs">{q.cron}</code>
                    </td>
                    <td className="px-3 py-2">
                      {q.pending < 0 ? (
                        <span className="text-destructive">err</span>
                      ) : q.pending === 0 ? (
                        <span className="text-muted-foreground">0</span>
                      ) : stuck ? (
                        <span className="font-semibold text-warning">
                          {q.pending}
                        </span>
                      ) : (
                        q.pending
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {q.running < 0 ? (
                        <span className="text-destructive">err</span>
                      ) : q.running === 0 ? (
                        <span className="text-muted-foreground">0</span>
                      ) : (
                        <span className="font-medium">{q.running}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {q.failed < 0 ? (
                        <span className="text-destructive">err</span>
                      ) : q.failed === 0 ? (
                        <span className="text-muted-foreground">0</span>
                      ) : (
                        <span className="font-semibold text-destructive">
                          {q.failed}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {ageString(q.oldestPendingAgeSec)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <H2>Cron schedule</H2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sourced from <code>vercel.json</code>. Last-run timestamps are not
          mirrored locally — check Vercel Dashboard → Cron Jobs for invocation
          history.
        </p>
        <div className="mt-3 overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Cadence</th>
                <th className="px-3 py-2 font-medium">Path</th>
                <th className="px-3 py-2 font-medium">Schedule</th>
                <th className="px-3 py-2 font-medium">Purpose</th>
              </tr>
            </thead>
            <tbody>
              {crons.map((c) => (
                <tr
                  key={c.path}
                  className="border-b align-top last:border-b-0 hover:bg-muted/30"
                >
                  <td className="px-3 py-2 text-muted-foreground">
                    <StatusPill
                      kind={
                        c.schedule === "* * * * *"
                          ? "run_running"
                          : "brief_committed"
                      }
                      label={c.cadence}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <code className="text-xs">{c.path}</code>
                  </td>
                  <td className="px-3 py-2">
                    <code className="text-xs text-muted-foreground">
                      {c.schedule}
                    </code>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {c.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
