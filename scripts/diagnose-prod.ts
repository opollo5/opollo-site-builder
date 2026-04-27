#!/usr/bin/env -S npx tsx
/**
 * scripts/diagnose-prod.ts
 *
 * Read-only diagnostic CLI for production state inspection. Lets
 * future investigations run common shape-of-state queries without
 * the operator hand-writing SQL in Supabase Studio.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx tsx scripts/diagnose-prod.ts <subcommand> [args]
 *
 * Subcommands:
 *
 *   brief-run <run-id>       Full state of a brief_run + its parent
 *                            brief + all brief_pages.
 *   brief-page <page-id>     One brief_pages row with HTML/critique
 *                            sizes + pass pointers + quality flag.
 *   cron-queue               What the brief-runner cron's WHERE
 *                            clause actually returns (replicates
 *                            app/api/cron/process-brief-runner's
 *                            dequeue query). Plus active non-queued
 *                            runs for triage context.
 *   tenant-budget <site-id>  Budget caps + usage + reset times,
 *                            plus a snapshot of recent cost events.
 *   health-deep              Row-level detail on every health check
 *                            /api/health computes (Supabase reach,
 *                            budget-reset backlog, stuck leases).
 *
 * Output:
 *   stdout — newline-terminated JSON document for the subcommand's
 *            result. Parseable with jq.
 *   stderr — short human-readable summary so the operator can read
 *            the result without piping. Hidden from stdout so
 *            `... | jq .data.run.status` keeps working.
 *
 * Read-only enforcement:
 *   The supabase client is wrapped in a Proxy that throws on
 *   .insert / .update / .delete / .upsert / .rpc. Attempts to mutate
 *   raise READ_ONLY_VIOLATION at call time; there is no bypass mode.
 *   To run a write, write a different script.
 *
 * # Adding a new subcommand
 *
 * 1. Add a string to the SubcommandName union below.
 * 2. Add a case in dispatch() that calls a new async function.
 * 3. The new function takes (rdb: ReadOnlyClient, args: string[])
 *    and returns the JSON-serialisable diagnostic payload.
 * 4. Update the header docs above + the printUsage() text.
 *
 * Subcommands MUST take the rdb instance, never the raw client.
 * That keeps the read-only invariant single-source.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Read-only client wrapper
// ---------------------------------------------------------------------------

const BLOCKED_BUILDER_METHODS = new Set([
  "insert",
  "update",
  "delete",
  "upsert",
]);

class ReadOnlyViolationError extends Error {
  constructor(table: string, op: string) {
    super(
      `READ_ONLY_VIOLATION: tried to call .${op}() on table "${table}". ` +
        `scripts/diagnose-prod.ts is read-only — write a separate script.`,
    );
    this.name = "ReadOnlyViolationError";
  }
}

type AnyBuilder = ReturnType<SupabaseClient["from"]>;

export type ReadOnlyClient = {
  from: (table: string) => AnyBuilder;
};

function createReadOnlyClient(client: SupabaseClient): ReadOnlyClient {
  return {
    from(table: string): AnyBuilder {
      const builder = client.from(table);
      return new Proxy(builder, {
        get(target, prop, receiver) {
          if (typeof prop === "string" && BLOCKED_BUILDER_METHODS.has(prop)) {
            return () => {
              throw new ReadOnlyViolationError(table, prop);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as AnyBuilder;
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function die(msg: string, code: number = 1): never {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(code);
}

function requireUuid(value: string | undefined, name: string): string {
  if (!value) die(`${name} is required.`);
  if (!UUID_RE.test(value)) die(`${name} must be a UUID; got: ${value}`);
  return value;
}

function nowIso(): string {
  return new Date().toISOString();
}

function emit(payload: unknown): void {
  // stdout: JSON; one trailing newline so common tools play nice.
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function summary(lines: string[]): void {
  process.stderr.write(`${lines.join("\n")}\n`);
}

function ageSeconds(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 1000);
}

function fmtAge(seconds: number | null): string {
  if (seconds === null) return "never";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

// ---------------------------------------------------------------------------
// Subcommand: brief-run <run-id>
// ---------------------------------------------------------------------------

async function diagnoseBriefRun(
  rdb: ReadOnlyClient,
  args: string[],
): Promise<unknown> {
  const runId = requireUuid(args[0], "<run-id>");

  const runRes = await rdb
    .from("brief_runs")
    .select(
      "id, brief_id, status, current_ordinal, worker_id, lease_expires_at, last_heartbeat_at, started_at, finished_at, failure_code, failure_detail, cancel_requested_at, version_lock, created_at, updated_at, deleted_at",
    )
    .eq("id", runId)
    .maybeSingle();
  if (runRes.error) die(`brief_runs read failed: ${runRes.error.message}`);
  if (!runRes.data) die(`No brief_runs row with id ${runId}.`);
  const run = runRes.data as Record<string, unknown>;

  const briefId = run.brief_id as string;
  const briefRes = await rdb
    .from("briefs")
    .select(
      "id, site_id, title, status, source_size_bytes, parser_mode, parse_failure_code, parse_failure_detail, committed_at, version_lock, created_at, updated_at, deleted_at",
    )
    .eq("id", briefId)
    .maybeSingle();
  if (briefRes.error) die(`briefs read failed: ${briefRes.error.message}`);

  const pagesRes = await rdb
    .from("brief_pages")
    .select(
      "id, ordinal, title, mode, page_status, current_pass_kind, current_pass_number, page_cost_cents, quality_flag, approved_at, version_lock, word_count, deleted_at, updated_at",
    )
    .eq("brief_id", briefId)
    .order("ordinal", { ascending: true });
  if (pagesRes.error) die(`brief_pages read failed: ${pagesRes.error.message}`);
  const pages = (pagesRes.data ?? []) as Array<Record<string, unknown>>;

  const pageStatusCounts: Record<string, number> = {};
  for (const p of pages) {
    const s = String(p.page_status ?? "<null>");
    pageStatusCounts[s] = (pageStatusCounts[s] ?? 0) + 1;
  }

  summary([
    "── brief-run ──",
    `  run.id:               ${run.id}`,
    `  run.status:           ${run.status}`,
    `  run.current_ordinal:  ${run.current_ordinal ?? "<null>"}`,
    `  run.worker_id:        ${run.worker_id ?? "<null>"}`,
    `  run.lease_expires_at: ${run.lease_expires_at ?? "<null>"} (age ${fmtAge(ageSeconds(run.lease_expires_at as string | null))})`,
    `  run.last_heartbeat:   ${run.last_heartbeat_at ?? "<null>"} (age ${fmtAge(ageSeconds(run.last_heartbeat_at as string | null))})`,
    `  run.failure_code:     ${run.failure_code ?? "<null>"}`,
    `  run.created_at:       ${run.created_at} (age ${fmtAge(ageSeconds(run.created_at as string))})`,
    `  brief.id:             ${briefRes.data?.id ?? "<missing>"}`,
    `  brief.status:         ${briefRes.data?.status ?? "<missing>"}`,
    `  brief.committed_at:   ${(briefRes.data as Record<string, unknown> | null)?.committed_at ?? "<null>"}`,
    `  pages:                ${pages.length} total — ${JSON.stringify(pageStatusCounts)}`,
  ]);

  return {
    subcommand: "brief-run",
    queried_at: nowIso(),
    data: {
      run,
      brief: briefRes.data ?? null,
      pages,
      derived: {
        page_count: pages.length,
        page_status_counts: pageStatusCounts,
        run_age_seconds: ageSeconds(run.created_at as string),
        lease_age_seconds: ageSeconds(run.lease_expires_at as string | null),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Subcommand: brief-page <page-id>
// ---------------------------------------------------------------------------

async function diagnoseBriefPage(
  rdb: ReadOnlyClient,
  args: string[],
): Promise<unknown> {
  const pageId = requireUuid(args[0], "<page-id>");

  const pageRes = await rdb
    .from("brief_pages")
    .select(
      "id, brief_id, ordinal, title, slug_hint, mode, page_status, current_pass_kind, current_pass_number, page_cost_cents, quality_flag, approved_at, version_lock, source_span_start, source_span_end, word_count, draft_html, generated_html, critique_log, deleted_at, created_at, updated_at",
    )
    .eq("id", pageId)
    .maybeSingle();
  if (pageRes.error) die(`brief_pages read failed: ${pageRes.error.message}`);
  if (!pageRes.data) die(`No brief_pages row with id ${pageId}.`);
  const page = pageRes.data as Record<string, unknown>;

  const draftHtml = (page.draft_html as string | null | undefined) ?? null;
  const generatedHtml = (page.generated_html as string | null | undefined) ?? null;
  const critiqueLog = (page.critique_log as unknown[] | null | undefined) ?? null;
  const draftHtmlLen = draftHtml ? draftHtml.length : 0;
  const generatedHtmlLen = generatedHtml ? generatedHtml.length : 0;
  const critiqueEntries = Array.isArray(critiqueLog) ? critiqueLog.length : 0;

  // Strip the bulky HTML/critique fields from the JSON payload — they're
  // rarely useful at full size in a diagnostic dump and they bloat stdout.
  // The lengths + presence flags below are the diagnostic signal.
  const slim: Record<string, unknown> = { ...page };
  slim.draft_html = draftHtml === null ? null : `<${draftHtmlLen} chars>`;
  slim.generated_html =
    generatedHtml === null ? null : `<${generatedHtmlLen} chars>`;
  slim.critique_log = critiqueLog === null ? null : `<${critiqueEntries} entries>`;

  summary([
    "── brief-page ──",
    `  id:                    ${page.id}`,
    `  brief_id:              ${page.brief_id}`,
    `  ordinal:               ${page.ordinal}`,
    `  page_status:           ${page.page_status ?? "<null>"}`,
    `  current_pass_kind:     ${page.current_pass_kind ?? "<null>"}`,
    `  current_pass_number:   ${page.current_pass_number ?? "<null>"}`,
    `  page_cost_cents:       ${page.page_cost_cents ?? 0}`,
    `  quality_flag:          ${page.quality_flag ?? "<null>"}`,
    `  approved_at:           ${page.approved_at ?? "<null>"}`,
    `  has_html:              ${draftHtmlLen > 0} (draft_html ${draftHtmlLen} chars)`,
    `  has_generated_html:    ${generatedHtml !== null} (${generatedHtmlLen} chars)`,
    `  critique_log entries:  ${critiqueEntries}`,
    `  version_lock:          ${page.version_lock}`,
    `  updated_at:            ${page.updated_at} (age ${fmtAge(ageSeconds(page.updated_at as string))})`,
  ]);

  return {
    subcommand: "brief-page",
    queried_at: nowIso(),
    data: {
      page: slim,
      derived: {
        has_html: draftHtmlLen > 0,
        has_generated_html: generatedHtml !== null,
        draft_html_length: draftHtmlLen,
        generated_html_length: generatedHtmlLen,
        critique_log_entries: critiqueEntries,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Subcommand: cron-queue
// ---------------------------------------------------------------------------

async function diagnoseCronQueue(rdb: ReadOnlyClient): Promise<unknown> {
  // Replicates the brief-runner cron's dequeue query verbatim:
  //   .from("brief_runs").eq("status", "queued").order("created_at", asc).limit(1)
  // — see app/api/cron/process-brief-runner/route.ts.
  const queuedRes = await rdb
    .from("brief_runs")
    .select(
      "id, brief_id, status, worker_id, lease_expires_at, current_ordinal, created_at",
    )
    .eq("status", "queued")
    .order("created_at", { ascending: true });
  if (queuedRes.error) die(`brief_runs queue read failed: ${queuedRes.error.message}`);
  const queued = (queuedRes.data ?? []) as Array<Record<string, unknown>>;

  // Active-but-not-queued runs. These are the rows the cron's WHERE
  // clause does NOT pick — useful when an operator expected a run to
  // be dequeued and got "nothing_queued" back.
  const activeRes = await rdb
    .from("brief_runs")
    .select(
      "id, brief_id, status, worker_id, lease_expires_at, last_heartbeat_at, current_ordinal, failure_code, created_at, updated_at",
    )
    .in("status", ["running", "paused", "failed"])
    .order("created_at", { ascending: false })
    .limit(20);
  if (activeRes.error) die(`brief_runs active read failed: ${activeRes.error.message}`);
  const active = (activeRes.data ?? []) as Array<Record<string, unknown>>;

  // Status histogram (current snapshot, not historical).
  const statusRes = await rdb
    .from("brief_runs")
    .select("id, status");
  if (statusRes.error) die(`brief_runs status read failed: ${statusRes.error.message}`);
  const statusCounts: Record<string, number> = {};
  for (const row of (statusRes.data ?? []) as Array<{ status: string }>) {
    statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;
  }

  const top = queued[0] ?? null;
  summary([
    "── cron-queue ──",
    `  status histogram (all rows): ${JSON.stringify(statusCounts)}`,
    `  queued length:               ${queued.length}`,
    `  next cron pick (top of queue): ${
      top
        ? `${top.id} (brief ${top.brief_id}, age ${fmtAge(ageSeconds(top.created_at as string))})`
        : "<empty queue — cron returns 'nothing_queued'>"
    }`,
    `  active non-queued runs (running/paused/failed): ${active.length}`,
  ]);

  return {
    subcommand: "cron-queue",
    queried_at: nowIso(),
    data: {
      cron_query_replication: {
        from: "brief_runs",
        where: { status: "queued" },
        order: { column: "created_at", ascending: true },
        limit: 1,
        next_pick: top,
      },
      queued_runs: queued,
      active_non_queued_runs: active,
      status_histogram: statusCounts,
    },
  };
}

// ---------------------------------------------------------------------------
// Subcommand: tenant-budget <site-id>
// ---------------------------------------------------------------------------

async function diagnoseTenantBudget(
  rdb: ReadOnlyClient,
  args: string[],
): Promise<unknown> {
  const siteId = requireUuid(args[0], "<site-id>");

  const budgetRes = await rdb
    .from("tenant_cost_budgets")
    .select(
      "id, site_id, daily_cap_cents, monthly_cap_cents, daily_usage_cents, monthly_usage_cents, daily_reset_at, monthly_reset_at, version_lock, created_at, updated_at",
    )
    .eq("site_id", siteId)
    .maybeSingle();
  if (budgetRes.error) die(`tenant_cost_budgets read failed: ${budgetRes.error.message}`);
  if (!budgetRes.data) die(`No tenant_cost_budgets row for site ${siteId}.`);
  const b = budgetRes.data as Record<string, number | string>;

  const siteRes = await rdb
    .from("sites")
    .select("id, name, status, created_at")
    .eq("id", siteId)
    .maybeSingle();
  if (siteRes.error) die(`sites read failed: ${siteRes.error.message}`);

  // Recent cost activity from generation_events (the M3 batch path).
  // generation_events.cost_cents accumulates per-page billed work.
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const eventsRes = await rdb
    .from("generation_events")
    .select("id, generation_job_id, event_type, cost_cents, created_at")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(50);
  // Soft-fail: not all environments have generation_events activity;
  // missing data isn't a hard error, just an empty list.
  const events =
    eventsRes.error || !Array.isArray(eventsRes.data) ? [] : eventsRes.data;

  const dailyPct =
    Number(b.daily_cap_cents) > 0
      ? (Number(b.daily_usage_cents) / Number(b.daily_cap_cents)) * 100
      : 0;
  const monthlyPct =
    Number(b.monthly_cap_cents) > 0
      ? (Number(b.monthly_usage_cents) / Number(b.monthly_cap_cents)) * 100
      : 0;

  summary([
    "── tenant-budget ──",
    `  site:                 ${(siteRes.data as { id?: string; name?: string } | null)?.name ?? "<missing>"} (${siteId})`,
    `  daily:                ${b.daily_usage_cents} / ${b.daily_cap_cents} cents (${dailyPct.toFixed(1)}%)`,
    `  monthly:              ${b.monthly_usage_cents} / ${b.monthly_cap_cents} cents (${monthlyPct.toFixed(1)}%)`,
    `  daily_reset_at:       ${b.daily_reset_at}`,
    `  monthly_reset_at:     ${b.monthly_reset_at}`,
    `  recent events (24h):  ${events.length}`,
  ]);

  return {
    subcommand: "tenant-budget",
    queried_at: nowIso(),
    data: {
      site: siteRes.data ?? null,
      budget: b,
      derived: {
        daily_usage_pct: dailyPct,
        monthly_usage_pct: monthlyPct,
        daily_reset_overdue:
          Date.parse(String(b.daily_reset_at)) < Date.now(),
        monthly_reset_overdue:
          Date.parse(String(b.monthly_reset_at)) < Date.now(),
      },
      recent_generation_events_24h: events,
    },
  };
}

// ---------------------------------------------------------------------------
// Subcommand: health-deep
// ---------------------------------------------------------------------------

async function diagnoseHealthDeep(rdb: ReadOnlyClient): Promise<unknown> {
  // 1. Supabase reach — same probe as /api/health.
  const reachRes = await rdb
    .from("opollo_config")
    .select("key")
    .limit(1);
  const supabaseOk = !reachRes.error;

  // 2. Budget reset backlog: tenant_cost_budgets where daily_reset_at
  //    is more than 25h overdue. /api/health uses 25h as the warn line.
  const cutoffIso = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const dailyBacklogRes = await rdb
    .from("tenant_cost_budgets")
    .select("id, site_id, daily_reset_at, monthly_reset_at")
    .lt("daily_reset_at", cutoffIso);
  const monthlyBacklogRes = await rdb
    .from("tenant_cost_budgets")
    .select("id, site_id, daily_reset_at, monthly_reset_at")
    .lt("monthly_reset_at", new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString());

  // 3. Stuck brief_runs: status='running' with lease past expiry.
  const stuckRunsRes = await rdb
    .from("brief_runs")
    .select(
      "id, brief_id, status, worker_id, lease_expires_at, last_heartbeat_at, current_ordinal, updated_at",
    )
    .eq("status", "running")
    .lt("lease_expires_at", nowIso())
    .order("lease_expires_at", { ascending: true })
    .limit(20);

  // 4. Recent failures (last 24h).
  const failureSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const failedRunsRes = await rdb
    .from("brief_runs")
    .select(
      "id, brief_id, failure_code, failure_detail, finished_at",
    )
    .eq("status", "failed")
    .gte("finished_at", failureSince)
    .order("finished_at", { ascending: false })
    .limit(20);

  const stuckRuns = (stuckRunsRes.data ?? []) as unknown[];
  const failedRuns = (failedRunsRes.data ?? []) as unknown[];
  const dailyBacklog = (dailyBacklogRes.data ?? []) as unknown[];
  const monthlyBacklog = (monthlyBacklogRes.data ?? []) as unknown[];

  const overall =
    supabaseOk &&
    dailyBacklog.length === 0 &&
    monthlyBacklog.length === 0 &&
    stuckRuns.length === 0
      ? "ok"
      : "degraded";

  summary([
    "── health-deep ──",
    `  overall:                       ${overall}`,
    `  supabase reachable:            ${supabaseOk}`,
    `  budget reset backlog (daily):  ${dailyBacklog.length}`,
    `  budget reset backlog (monthly): ${monthlyBacklog.length}`,
    `  stuck running brief_runs:      ${stuckRuns.length}`,
    `  recent failed brief_runs (24h): ${failedRuns.length}`,
  ]);

  return {
    subcommand: "health-deep",
    queried_at: nowIso(),
    data: {
      overall,
      checks: {
        supabase: { ok: supabaseOk, error: reachRes.error?.message ?? null },
        budget_reset_backlog_daily: dailyBacklog,
        budget_reset_backlog_monthly: monthlyBacklog,
        stuck_running_brief_runs: stuckRuns,
        recent_failed_brief_runs_24h: failedRuns,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const SUBCOMMANDS = [
  "brief-run",
  "brief-page",
  "cron-queue",
  "tenant-budget",
  "health-deep",
] as const;
type SubcommandName = (typeof SUBCOMMANDS)[number];

function isSubcommand(s: string): s is SubcommandName {
  return (SUBCOMMANDS as readonly string[]).includes(s);
}

async function dispatch(
  name: SubcommandName,
  rdb: ReadOnlyClient,
  args: string[],
): Promise<unknown> {
  switch (name) {
    case "brief-run":
      return diagnoseBriefRun(rdb, args);
    case "brief-page":
      return diagnoseBriefPage(rdb, args);
    case "cron-queue":
      return diagnoseCronQueue(rdb);
    case "tenant-budget":
      return diagnoseTenantBudget(rdb, args);
    case "health-deep":
      return diagnoseHealthDeep(rdb);
  }
}

function printUsage(): void {
  process.stderr.write(
    [
      "Usage: tsx scripts/diagnose-prod.ts <subcommand> [args]",
      "",
      "Subcommands:",
      "  brief-run <run-id>       brief_run + brief + brief_pages",
      "  brief-page <page-id>     single page state",
      "  cron-queue               brief-runner cron's WHERE clause output",
      "  tenant-budget <site-id>  budget state + recent usage",
      "  health-deep              row-level health detail",
      "",
      "Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY",
      "",
      "Read-only enforced: any .insert / .update / .delete / .upsert call",
      "throws READ_ONLY_VIOLATION at runtime.",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === "--help" || cmd === "-h") {
    printUsage();
    return cmd ? 0 : 2;
  }
  if (!isSubcommand(cmd)) {
    process.stderr.write(`Unknown subcommand: ${cmd}\n`);
    printUsage();
    return 2;
  }

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) die("SUPABASE_URL is not set.");
  if (!serviceRoleKey) die("SUPABASE_SERVICE_ROLE_KEY is not set.");

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const rdb = createReadOnlyClient(supabase);

  const result = await dispatch(cmd, rdb, argv.slice(1));
  emit(result);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    if (err instanceof ReadOnlyViolationError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(3);
    }
    process.stderr.write("diagnose-prod: fatal error\n");
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  },
);
