#!/usr/bin/env -S npx tsx
/**
 * recover-stuck-brief-page.ts
 *
 * One-shot recovery for a brief_page that landed in awaiting_review
 * with NULL or malformed draft_html — typically after a runner bug
 * (UAT-smoke-1: markdown-fenced HTML) was patched. The script flips
 * the page back to 'pending' and the run back to 'running', clears
 * the page's accumulated pass state (draft_html, critique_log, cost,
 * pass pointers, quality_flag), and lets the runner cron pick it up
 * on the next tick (~1 minute, schedule = `* * * * *`).
 *
 * Usage:
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx tsx scripts/recover-stuck-brief-page.ts \
 *       --page-id <uuid> \
 *       [--dry-run] \
 *       [--confirm]
 *
 * Without --confirm the script prints what it would change and exits 2.
 * Mirrors the seed-istock-library.ts mental model.
 *
 * What it touches:
 *
 *   brief_pages (one row):
 *     - page_status        : awaiting_review|failed → pending
 *     - draft_html         : * → NULL
 *     - critique_log       : * → []
 *     - current_pass_kind  : * → NULL
 *     - current_pass_number: * → 0
 *     - page_cost_cents    : * → 0
 *     - quality_flag       : * → NULL
 *     - approved_at        : * → NULL  (defensive; should already be NULL pre-approve)
 *     - version_lock       : bumped
 *
 *   brief_runs (the page's parent run):
 *     - status             : paused|failed → running
 *     - finished_at        : * → NULL
 *     - failure_code       : * → NULL
 *     - failure_detail     : * → NULL
 *     - lease_expires_at   : * → NULL  (so the next worker can lease)
 *     - worker_id          : * → NULL
 *     - run_cost_cents     : (kept — historical accounting; new run cost
 *                             accumulates on top)
 *     - version_lock       : bumped
 *
 * Idempotency: re-running on a page already in 'pending' is a no-op
 * write (the UPDATE matches but the values don't change in operator-
 * meaningful ways; version_lock still bumps, cron picks up on the
 * next tick).
 *
 * Refunds: the page_cost_cents is RESET to 0; the previous spend
 * (the bug-cycle dollars) stays accounted on the run's run_cost_cents
 * for billing reconciliation. The next run accumulates fresh cost.
 */

import { createClient } from "@supabase/supabase-js";

type CliArgs = {
  pageId?: string;
  dryRun: boolean;
  confirm: boolean;
};

function die(msg: string, code: number = 1): never {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { dryRun: false, confirm: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--page-id") args.pageId = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--confirm") args.confirm = true;
    else if (a === "--help" || a === "-h") {
      printUsage();
      process.exit(0);
    } else {
      console.error(`Unknown flag: ${a}`);
      printUsage();
      process.exit(2);
    }
  }
  return args;
}

function printUsage(): void {
  process.stderr.write(
    [
      "Usage: tsx scripts/recover-stuck-brief-page.ts --page-id <uuid> [options]",
      "  --page-id <uuid>   Required. brief_pages.id of the stuck page.",
      "  --dry-run          Print the targeted state; no DB writes.",
      "  --confirm          Required for real runs (opt-in guard).",
      "",
      "Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY",
      "",
    ].join("\n"),
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.pageId) {
    printUsage();
    return 2;
  }
  if (!UUID_RE.test(args.pageId)) {
    die(`--page-id must be a UUID; got: ${args.pageId}`);
  }

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) die("SUPABASE_URL is not set.");
  if (!serviceRoleKey) die("SUPABASE_SERVICE_ROLE_KEY is not set.");

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // 1. Read the page + the run it belongs to.
  const pageRes = await supabase
    .from("brief_pages")
    .select("id, brief_id, ordinal, page_status, quality_flag, page_cost_cents, version_lock, draft_html")
    .eq("id", args.pageId)
    .maybeSingle();
  if (pageRes.error) {
    die(`Failed to read brief_pages row: ${pageRes.error.message}`);
  }
  if (!pageRes.data) {
    die(`No brief_pages row with id ${args.pageId}.`);
  }
  const page = pageRes.data as {
    id: string;
    brief_id: string;
    ordinal: number;
    page_status: string;
    quality_flag: string | null;
    page_cost_cents: number;
    version_lock: number;
    draft_html: string | null;
  };

  // brief_runs row keyed by brief_id (one active run per brief; we pick
  // the most recent non-terminal one).
  const runRes = await supabase
    .from("brief_runs")
    .select("id, status, run_cost_cents, version_lock, current_ordinal")
    .eq("brief_id", page.brief_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runRes.error) {
    die(`Failed to read brief_runs row: ${runRes.error.message}`);
  }
  if (!runRes.data) {
    die(`No brief_runs row found for brief ${page.brief_id}.`);
  }
  const run = runRes.data as {
    id: string;
    status: string;
    run_cost_cents: number;
    version_lock: number;
    current_ordinal: number | null;
  };

  process.stdout.write(
    [
      "Recovery plan",
      `  Page id:          ${page.id}`,
      `  Brief id:         ${page.brief_id}`,
      `  Page ordinal:     ${page.ordinal}`,
      `  Current page_status:    ${page.page_status}`,
      `  Current quality_flag:   ${page.quality_flag ?? "<null>"}`,
      `  Current page_cost_cents: ${page.page_cost_cents}`,
      `  Current draft_html len:  ${(page.draft_html ?? "").length}`,
      `  Brief run id:           ${run.id}`,
      `  Brief run status:       ${run.status}`,
      `  Brief run cost cents:   ${run.run_cost_cents}`,
      "",
      "Will reset:",
      "  brief_pages: page_status='pending', draft_html=NULL, critique_log=[],",
      "               current_pass_kind=NULL, current_pass_number=0, page_cost_cents=0,",
      "               quality_flag=NULL, approved_at=NULL, version_lock+=1",
      "  brief_runs:  status='running', finished_at=NULL, failure_code=NULL,",
      "               failure_detail=NULL, lease_expires_at=NULL, worker_id=NULL,",
      "               version_lock+=1",
      "",
    ].join("\n"),
  );

  if (args.dryRun) {
    process.stdout.write("Dry-run — no DB writes performed.\n");
    return 0;
  }
  if (!args.confirm) {
    process.stderr.write(
      "Pass --confirm to execute the recovery, or --dry-run to preview.\n",
    );
    return 2;
  }

  // 2. Reset the page under CAS.
  const pageUpd = await supabase
    .from("brief_pages")
    .update({
      page_status: "pending",
      draft_html: null,
      critique_log: [],
      current_pass_kind: null,
      current_pass_number: 0,
      page_cost_cents: 0,
      quality_flag: null,
      approved_at: null,
      version_lock: page.version_lock + 1,
    })
    .eq("id", page.id)
    .eq("version_lock", page.version_lock)
    .select("id, page_status, version_lock")
    .single();
  if (pageUpd.error || !pageUpd.data) {
    die(
      `Page CAS reset failed (the row may have been edited concurrently): ${
        pageUpd.error?.message ?? "no rows updated"
      }`,
    );
  }
  process.stdout.write(
    `  brief_pages reset: page_status=${pageUpd.data.page_status}, version_lock=${pageUpd.data.version_lock}\n`,
  );

  // 3. Reset the run under CAS.
  const runUpd = await supabase
    .from("brief_runs")
    .update({
      status: "running",
      finished_at: null,
      failure_code: null,
      failure_detail: null,
      lease_expires_at: null,
      worker_id: null,
      version_lock: run.version_lock + 1,
    })
    .eq("id", run.id)
    .eq("version_lock", run.version_lock)
    .select("id, status, version_lock")
    .single();
  if (runUpd.error || !runUpd.data) {
    die(
      `Run CAS reset failed (the row may have been edited concurrently): ${
        runUpd.error?.message ?? "no rows updated"
      }`,
    );
  }
  process.stdout.write(
    `  brief_runs reset:  status=${runUpd.data.status}, version_lock=${runUpd.data.version_lock}\n`,
  );

  process.stdout.write(
    [
      "",
      "Recovery complete. The brief-runner cron (* * * * *) will pick up",
      "the page on its next tick (within 60 seconds). Verify by polling:",
      "",
      `  SELECT page_status, current_pass_kind, current_pass_number, draft_html IS NOT NULL`,
      `    FROM brief_pages WHERE id = '${page.id}';`,
      "",
      "Successful reprocess: page_status flips through 'generating' →",
      "'awaiting_review' (with draft_html populated, quality_flag=NULL if",
      "the gate passes, or quality_flag='capped_with_issues' if structural",
      "drift remains).",
      "",
    ].join("\n"),
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("recover-stuck-brief-page: fatal error");
    console.error(err);
    process.exit(1);
  },
);
