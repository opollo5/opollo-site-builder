import "server-only";

import { Client } from "pg";

import {
  defaultAnthropicCall,
  type AnthropicCallFn,
  type AnthropicResponse,
} from "@/lib/anthropic-call";
import type {
  BriefPageCritiqueEntry,
  BriefPagePassKind,
  BriefPageRow,
  BriefPageStatus,
  BriefRow,
} from "@/lib/briefs";
import { logger } from "@/lib/logger";
import {
  ANCHOR_EXTRA_CYCLES,
  SiteConventionsSchema,
  freezeSiteConventions,
  getSiteConventions,
  type SiteConventions,
} from "@/lib/site-conventions";
import { getServiceRoleClient } from "@/lib/supabase";
import {
  BRIEF_ANCHOR_PAGE_CEILING_CENTS,
  BRIEF_PAGE_CEILING_CENTS,
  releaseBudget,
  reserveWithCeiling,
} from "@/lib/tenant-budgets";

// ---------------------------------------------------------------------------
// M12-3 — Brief runner.
//
// Write-safety-critical slice. Every primitive here serialises the work
// the rest of M12 (visual review pass M12-4, operator surface M12-5)
// depends on. A bug here means either:
//
//   - Two workers process the same brief (→ Anthropic billed twice per pass,
//     partially overwritten draft_html, inconsistent site_conventions)
//   - A pass writes twice to DB without the Anthropic side being idempotent
//     (→ Anthropic billed twice per pass retry)
//   - current_pass_kind/current_pass_number drift from the actual state
//     (→ resume-after-crash re-enters at the wrong pass)
//
// The concurrency contract reuses four primitives from M3's batch-worker,
// adapted to one-page-at-a-time semantics:
//
//   leaseBriefRun(briefRunId, workerId, leaseDurationMs)
//     One transaction:
//       BEGIN;
//       SELECT … FOR UPDATE
//         WHERE id = $1 AND status IN ('queued','running','paused')
//               AND (lease_expires_at IS NULL OR lease_expires_at < now());
//       UPDATE … SET status='running', worker_id, lease_expires_at, …;
//       COMMIT;
//     The DB partial UNIQUE index `brief_runs_one_active_per_brief`
//     already rejects a second queued/running/paused run per brief at
//     INSERT time (23505). leaseBriefRun races the same row are
//     serialised by the row lock; the loser's UPDATE returns zero
//     rows and the runner abandons.
//
//   heartbeatBriefRun(briefRunId, workerId, leaseDurationMs)
//     Mirror of M3 heartbeat. Extends lease iff worker_id still
//     matches; zero rows = lease stolen, caller abandons.
//
//   reapExpiredBriefRuns(now)
//     Resets any running/paused run with expired lease back to 'queued'
//     (worker_id=NULL, lease_expires_at=NULL) so the next tick can claim.
//     FOR UPDATE SKIP LOCKED handles concurrent reapers.
//
//   processBriefRunTick(briefRunId, workerId, opts)
//     Entry point for the cron tick. Claims the lease, advances ONE
//     page state (possibly running its multi-pass loop), writes the
//     resulting state, releases the lease (or leaves it running for
//     the next tick if there's more work). Pause-mode only for M12-3
//     — the runner halts at page N's awaiting_review and waits for
//     the operator's approve action (M12-5 UI wraps the route that
//     advances current_ordinal).
//
// Per-pass idempotency is anchored at Anthropic via a stable key
// `brief:${briefId}:p${ordinal}:${passKind}:${passNumber}`. A retry
// within Anthropic's 24h idempotency window replays the original
// response (no double billing). After the Anthropic call returns,
// the runner UPDATEs the brief_pages row (draft_html, critique_log,
// current_pass_kind, current_pass_number) under version_lock CAS.
// Operator edits to the same page during a run raise VERSION_CONFLICT
// which the runner surfaces as page_status='failed'.
//
// Resume-after-crash: the runner reads current_pass_kind +
// current_pass_number, replays the same Anthropic call (Anthropic
// server-side idempotency cache returns the same response), and
// re-writes the DB. The idempotency of Anthropic + the CAS on
// brief_pages.version_lock mean a single crash never costs more than
// one replayed response (free) and never corrupts page state.
// ---------------------------------------------------------------------------

export const DEFAULT_LEASE_MS = 180_000; // 180s — same ceiling as M3.
export const DEFAULT_HEARTBEAT_MS = 30_000;

// Hard cap on text passes per page (parent plan §Multi-pass cost blowup).
// Standard page = draft + self_critique + revise = 3 passes.
// Anchor page = standard + ANCHOR_EXTRA_CYCLES extra revises.
export const STANDARD_TEXT_PASSES = 3; // draft, self_critique, revise

// Model + token budget. Opus is the default per product decision; tests
// substitute a stub call function entirely so model choice here is just
// a label.
export const RUNNER_MODEL = "claude-opus-4-7";
export const RUNNER_MAX_TOKENS = 4096;

// Cap on brief_runs.content_summary length. Parent plan §Running-summary
// budget says ~2k tokens; we measure in chars (4 chars ≈ 1 token average)
// so 8000 is a generous approximation. Compaction logic in
// appendToContentSummary kicks in when the char budget is exceeded.
export const CONTENT_SUMMARY_MAX_CHARS = 8000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BriefRunRow = {
  id: string;
  brief_id: string;
  status:
    | "queued"
    | "running"
    | "paused"
    | "succeeded"
    | "failed"
    | "cancelled";
  current_ordinal: number | null;
  worker_id: string | null;
  lease_expires_at: string | null;
  last_heartbeat_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  failure_code: string | null;
  failure_detail: string | null;
  cancel_requested_at: string | null;
  content_summary: string;
  version_lock: number;
  created_at: string;
  updated_at: string;
};

export type BriefRunTickOk = {
  ok: true;
  outcome:
    | "lease_acquired_no_advance"
    | "page_advanced_to_review" // pause point; operator must approve
    | "page_failed" // gate fail or Anthropic terminal error
    | "run_completed" // no more pages
    | "lease_stolen"
    | "nothing_to_do"; // status already terminal or awaiting_review
  runStatus: BriefRunRow["status"];
  currentOrdinal: number | null;
  pageStatus: BriefPageStatus | null;
};

export type BriefRunTickFail = {
  ok: false;
  code:
    | "NOT_FOUND"
    | "INTERNAL_ERROR"
    | "BRIEF_NOT_COMMITTED"
    | "ANCHOR_FAILED"
    | "BUDGET_EXCEEDED"
    | "VERSION_CONFLICT"
    | "LEASE_STOLEN";
  message: string;
  details?: Record<string, unknown>;
};

export type BriefRunTickResult = BriefRunTickOk | BriefRunTickFail;

export type BriefRunTickOpts = {
  workerId?: string;
  leaseDurationMs?: number;
  anthropicCall?: AnthropicCallFn;
  // Injected clock for tests that need to make lease math deterministic.
  nowMs?: () => number;
  // Advisory override: if the caller supplies a pg.Client, the runner
  // uses it instead of spinning up its own. Tests use this to share a
  // transaction across seed + tick.
  client?: Client;
};

// ---------------------------------------------------------------------------
// Env + client plumbing
// ---------------------------------------------------------------------------

function requireDbUrl(): string {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      "SUPABASE_DB_URL is not set. Required by the brief runner for direct transactions.",
    );
  }
  return url;
}

async function withClient<T>(
  provided: Client | null,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  if (provided) return fn(provided);
  const c = new Client({ connectionString: requireDbUrl() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

// ---------------------------------------------------------------------------
// Lease primitives
// ---------------------------------------------------------------------------

/**
 * Claim the lease on a brief_run. Returns the row on success; null if
 * the run is already being processed by another worker, is terminal,
 * or does not exist.
 */
export async function leaseBriefRun(
  client: Client,
  briefRunId: string,
  workerId: string,
  leaseDurationMs: number = DEFAULT_LEASE_MS,
): Promise<BriefRunRow | null> {
  await client.query("BEGIN");
  try {
    const lockRes = await client.query<BriefRunRow>(
      `
      SELECT id, brief_id, status, current_ordinal, worker_id,
             lease_expires_at, last_heartbeat_at, started_at, finished_at,
             failure_code, failure_detail, cancel_requested_at,
             content_summary, version_lock, created_at, updated_at
        FROM brief_runs
       WHERE id = $1
         AND status IN ('queued','running','paused')
         AND (lease_expires_at IS NULL OR lease_expires_at < now())
       FOR UPDATE SKIP LOCKED
      `,
      [briefRunId],
    );
    const row = lockRes.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return null;
    }
    const updateRes = await client.query<BriefRunRow>(
      `
      UPDATE brief_runs
         SET status = 'running',
             worker_id = $2,
             lease_expires_at = now() + ($3 || ' milliseconds')::interval,
             last_heartbeat_at = now(),
             started_at = COALESCE(started_at, now()),
             updated_at = now(),
             version_lock = version_lock + 1
       WHERE id = $1
         AND version_lock = $4
      RETURNING id, brief_id, status, current_ordinal, worker_id,
                lease_expires_at, last_heartbeat_at, started_at, finished_at,
                failure_code, failure_detail, cancel_requested_at,
                content_summary, version_lock, created_at, updated_at
      `,
      [briefRunId, workerId, leaseDurationMs, row.version_lock],
    );
    if (updateRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query("COMMIT");
    return updateRes.rows[0]!;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

/**
 * Extend the lease on a brief_run. Returns true if the lease was
 * successfully extended; false if the caller no longer holds it
 * (worker_id mismatch, reaped, terminal).
 */
export async function heartbeatBriefRun(
  client: Client,
  briefRunId: string,
  workerId: string,
  leaseDurationMs: number = DEFAULT_LEASE_MS,
): Promise<boolean> {
  const res = await client.query(
    `
    UPDATE brief_runs
       SET lease_expires_at = now() + ($3 || ' milliseconds')::interval,
           last_heartbeat_at = now(),
           updated_at = now()
     WHERE id = $1 AND worker_id = $2 AND status = 'running'
    `,
    [briefRunId, workerId, leaseDurationMs],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Reap expired leases. Non-terminal runs whose lease has passed without
 * a heartbeat are reset to 'queued' so the next tick can reclaim.
 * Returns the count reset.
 */
export async function reapExpiredBriefRuns(
  client: Client,
): Promise<{ reapedCount: number }> {
  const res = await client.query(
    `
    UPDATE brief_runs
       SET status = 'queued',
           worker_id = NULL,
           lease_expires_at = NULL,
           updated_at = now(),
           version_lock = version_lock + 1
     WHERE id IN (
       SELECT id
         FROM brief_runs
        WHERE status IN ('running','paused')
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at < now()
        FOR UPDATE SKIP LOCKED
     )
    `,
  );
  return { reapedCount: res.rowCount ?? 0 };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function passIdempotencyKey(opts: {
  briefId: string;
  ordinal: number;
  passKind: BriefPagePassKind;
  passNumber: number;
}): string {
  return `brief:${opts.briefId}:p${opts.ordinal}:${opts.passKind}:${opts.passNumber}`;
}

function extractText(resp: AnthropicResponse): string {
  return resp.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

// Very lightweight convention extractor. The final revise pass is
// prompted to return JSON; we attempt to parse the last fenced JSON
// block. If parsing fails we fall back to a minimal conventions object
// (the anchor "stabilises" whatever Claude produced, empty if
// unstructured). M12-4+ will refine the prompt + extractor; M12-3
// just needs the extraction seam.
function extractConventionsFromRevise(text: string): SiteConventions {
  const fence = /```json\s*([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let last: string | null = null;
  while ((match = fence.exec(text)) !== null) {
    last = match[1] ?? null;
  }
  if (last) {
    try {
      const parsed = JSON.parse(last);
      const res = SiteConventionsSchema.safeParse(parsed);
      if (res.success) return res.data;
    } catch {
      // fall through
    }
  }
  return SiteConventionsSchema.parse({});
}

// Very lightweight HTML extractor: strip fenced code blocks; return
// the remaining text. Production prompts in M12-4+ will return
// structured output with explicit HTML markers; M12-3 takes whatever
// Claude produces.
function extractDraftHtml(text: string): string {
  return text.replace(/```[a-z]*\s*[\s\S]*?```/g, "").trim();
}

function appendToContentSummary(current: string, addendum: string): string {
  const candidate = current.length === 0 ? addendum : `${current}\n\n${addendum}`;
  if (candidate.length <= CONTENT_SUMMARY_MAX_CHARS) return candidate;
  // Over cap: keep the second half of current + the new addendum.
  // Compaction in the sense of "Claude rewrites a compact summary"
  // lands in a follow-up; for M12-3 a bounded FIFO trim keeps the
  // size constant-bounded.
  const keepFromCurrent = current.slice(current.length / 2);
  const trimmed = `${keepFromCurrent}\n\n${addendum}`;
  return trimmed.length > CONTENT_SUMMARY_MAX_CHARS
    ? trimmed.slice(trimmed.length - CONTENT_SUMMARY_MAX_CHARS)
    : trimmed;
}

// ---------------------------------------------------------------------------
// Page-pass prompt construction (minimal, functional for M12-3)
// ---------------------------------------------------------------------------

type PageContext = {
  brief: BriefRow;
  page: BriefPageRow;
  contentSummary: string;
  siteConventions: SiteConventions | null;
  previousDraft: string | null;
  previousCritique: string | null;
};

function systemPromptFor(ctx: PageContext): string {
  const parts = [
    "You are a website page generator. You produce one HTML page at a time against a whole-site brief.",
    ctx.brief.brand_voice
      ? `\n<brand_voice>\n${ctx.brief.brand_voice}\n</brand_voice>`
      : "",
    ctx.brief.design_direction
      ? `\n<design_direction>\n${ctx.brief.design_direction}\n</design_direction>`
      : "",
    ctx.siteConventions
      ? `\n<site_conventions>\n${JSON.stringify(ctx.siteConventions)}\n</site_conventions>`
      : "",
    ctx.contentSummary
      ? `\n<content_summary>\n${ctx.contentSummary}\n</content_summary>`
      : "",
  ];
  return parts.join("");
}

function userPromptForDraft(ctx: PageContext): string {
  return [
    `<page_spec>\nTitle: ${ctx.page.title}\nMode: ${ctx.page.mode}\nOrdinal: ${ctx.page.ordinal}\n\n${ctx.page.source_text}\n</page_spec>`,
    "",
    "Produce the page's HTML. Respond with the HTML only.",
  ].join("\n");
}

function userPromptForSelfCritique(ctx: PageContext): string {
  return [
    `<page_spec>\nTitle: ${ctx.page.title}\nMode: ${ctx.page.mode}\n\n${ctx.page.source_text}\n</page_spec>`,
    "",
    `<draft>\n${ctx.previousDraft ?? ""}\n</draft>`,
    "",
    "Review the draft against the page spec, brand voice, design direction, and site conventions. Return a bulleted list of concrete revisions to apply.",
  ].join("\n");
}

function userPromptForRevise(ctx: PageContext, isAnchor: boolean): string {
  const anchorInstruction = isAnchor
    ? "\n\nAfter the HTML, append a ```json fenced block containing your chosen site_conventions JSON (typographic_scale, section_rhythm, hero_pattern, cta_phrasing, color_role_map, tone_register, additional)."
    : "";
  return [
    `<page_spec>\nTitle: ${ctx.page.title}\nMode: ${ctx.page.mode}\n\n${ctx.page.source_text}\n</page_spec>`,
    "",
    `<draft>\n${ctx.previousDraft ?? ""}\n</draft>`,
    "",
    `<critique>\n${ctx.previousCritique ?? ""}\n</critique>`,
    "",
    `Apply the critique to the draft. Respond with the revised HTML only.${anchorInstruction}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Pass execution
// ---------------------------------------------------------------------------

async function runOnePass(opts: {
  call: AnthropicCallFn;
  ctx: PageContext;
  passKind: BriefPagePassKind;
  passNumber: number;
  isAnchorFinalPass: boolean;
}): Promise<{
  text: string;
  response: AnthropicResponse;
}> {
  const { ctx } = opts;
  let userPrompt: string;
  switch (opts.passKind) {
    case "draft":
      userPrompt = userPromptForDraft(ctx);
      break;
    case "self_critique":
      userPrompt = userPromptForSelfCritique(ctx);
      break;
    case "revise":
      userPrompt = userPromptForRevise(ctx, opts.isAnchorFinalPass);
      break;
  }

  const response = await opts.call({
    model: RUNNER_MODEL,
    max_tokens: RUNNER_MAX_TOKENS,
    system: systemPromptFor(ctx),
    messages: [{ role: "user", content: userPrompt }],
    idempotency_key: passIdempotencyKey({
      briefId: ctx.brief.id,
      ordinal: ctx.page.ordinal,
      passKind: opts.passKind,
      passNumber: opts.passNumber,
    }),
  });
  return { text: extractText(response), response };
}

function nextPassAfter(
  kind: BriefPagePassKind | null,
  currentNumber: number,
  isAnchor: boolean,
): { kind: BriefPagePassKind; number: number } | null {
  // Linear sequence: draft → self_critique → revise. On anchor pages,
  // we append ANCHOR_EXTRA_CYCLES additional revises. After the last
  // revise we're done (return null → gates).
  if (kind === null) return { kind: "draft", number: 0 };
  if (kind === "draft") return { kind: "self_critique", number: currentNumber };
  if (kind === "self_critique") return { kind: "revise", number: 0 };
  if (kind === "revise") {
    const maxReviseNumber = isAnchor ? ANCHOR_EXTRA_CYCLES : 0;
    if (currentNumber < maxReviseNumber) {
      return { kind: "revise", number: currentNumber + 1 };
    }
    return null; // pass loop complete
  }
  return null;
}

// ---------------------------------------------------------------------------
// Quality gate hook
// ---------------------------------------------------------------------------

/**
 * Minimal gate function for M12-3: ensures draft_html is non-empty and
 * HTML-ish (contains at least one tag). M12-4+ plugs in the existing
 * lib/quality-gates.ts surface (HTML size cap, DS-token whitelist,
 * link integrity) which currently targets batch/regen outputs and
 * needs a thin adapter for brief-runner inputs.
 */
function runGatesForBriefPage(draftHtml: string | null): {
  ok: boolean;
  code?: string;
  message?: string;
} {
  if (!draftHtml || draftHtml.trim() === "") {
    return { ok: false, code: "EMPTY_HTML", message: "Draft HTML is empty." };
  }
  if (!/<[a-z][\s\S]*>/i.test(draftHtml)) {
    return {
      ok: false,
      code: "NOT_HTML",
      message: "Draft does not contain any HTML tags.",
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// processBriefRunTick — main entry point
// ---------------------------------------------------------------------------

export async function processBriefRunTick(
  briefRunId: string,
  opts: BriefRunTickOpts = {},
): Promise<BriefRunTickResult> {
  const workerId = opts.workerId ?? `runner-${process.pid}-${Date.now()}`;
  const leaseDurationMs = opts.leaseDurationMs ?? DEFAULT_LEASE_MS;
  const call = opts.anthropicCall ?? defaultAnthropicCall;

  return withClient(opts.client ?? null, async (client) => {
    const leased = await leaseBriefRun(
      client,
      briefRunId,
      workerId,
      leaseDurationMs,
    );
    if (!leased) {
      // Row might be terminal, or held by another worker.
      const existing = await client.query<BriefRunRow>(
        `SELECT status, current_ordinal FROM brief_runs WHERE id = $1`,
        [briefRunId],
      );
      const row = existing.rows[0];
      if (!row) {
        return {
          ok: false,
          code: "NOT_FOUND",
          message: `No brief_run ${briefRunId}.`,
        };
      }
      return {
        ok: true,
        outcome: "nothing_to_do",
        runStatus: row.status,
        currentOrdinal: row.current_ordinal,
        pageStatus: null,
      };
    }

    try {
      return await advanceOneStep(client, leased, call);
    } catch (err) {
      logger.error("brief_runner.tick_unhandled", {
        brief_run_id: briefRunId,
        error: err,
      });
      // Release the lease so another tick can retry. Do not mark failed
      // — unhandled errors are almost always transient (network, DB).
      await client.query(
        `
        UPDATE brief_runs
           SET lease_expires_at = NULL, worker_id = NULL, updated_at = now()
         WHERE id = $1 AND worker_id = $2
        `,
        [briefRunId, workerId],
      );
      return {
        ok: false,
        code: "INTERNAL_ERROR",
        message:
          "brief runner tick threw. Lease released for retry. See server log for details.",
      };
    }
  });
}

async function advanceOneStep(
  client: Client,
  run: BriefRunRow,
  call: AnthropicCallFn,
): Promise<BriefRunTickResult> {
  // Fetch the brief + current page.
  const briefRes = await client.query<BriefRow>(
    `SELECT * FROM briefs WHERE id = $1 AND deleted_at IS NULL`,
    [run.brief_id],
  );
  const brief = briefRes.rows[0];
  if (!brief) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: `Brief ${run.brief_id} not found.`,
    };
  }
  if (brief.status !== "committed") {
    return {
      ok: false,
      code: "BRIEF_NOT_COMMITTED",
      message: `Brief status is '${brief.status}'; must be 'committed' to run.`,
    };
  }

  // Determine ordinal. First tick: start at ordinal 0.
  let ordinal = run.current_ordinal ?? 0;

  // Skip past approved pages — loop here in case an operator approved
  // multiple pages while the runner was idle.
  while (true) {
    const pageRes = await client.query<BriefPageRow>(
      `
      SELECT * FROM brief_pages
       WHERE brief_id = $1 AND ordinal = $2 AND deleted_at IS NULL
      `,
      [run.brief_id, ordinal],
    );
    const page = pageRes.rows[0];
    if (!page) {
      // No page at this ordinal → run is complete.
      await client.query(
        `
        UPDATE brief_runs
           SET status = 'succeeded',
               finished_at = now(),
               lease_expires_at = NULL,
               worker_id = NULL,
               updated_at = now(),
               version_lock = version_lock + 1
         WHERE id = $1
        `,
        [run.id],
      );
      return {
        ok: true,
        outcome: "run_completed",
        runStatus: "succeeded",
        currentOrdinal: ordinal,
        pageStatus: null,
      };
    }
    if (page.page_status === "approved" || page.page_status === "skipped") {
      ordinal += 1;
      continue;
    }
    // Found a page to process; break and handle below.
    if (page.page_status === "awaiting_review") {
      // Nothing for the runner to do — operator must act.
      await client.query(
        `
        UPDATE brief_runs
           SET status = 'paused',
               current_ordinal = $2,
               lease_expires_at = NULL,
               worker_id = NULL,
               updated_at = now(),
               version_lock = version_lock + 1
         WHERE id = $1
        `,
        [run.id, ordinal],
      );
      return {
        ok: true,
        outcome: "page_advanced_to_review",
        runStatus: "paused",
        currentOrdinal: ordinal,
        pageStatus: "awaiting_review",
      };
    }
    if (page.page_status === "failed") {
      // A prior tick failed this page. Mark the run failed and stop;
      // the operator cancels or edits.
      await client.query(
        `
        UPDATE brief_runs
           SET status = 'failed',
               failure_code = COALESCE(failure_code, 'PAGE_FAILED'),
               failure_detail = COALESCE(failure_detail, $3),
               finished_at = now(),
               lease_expires_at = NULL,
               worker_id = NULL,
               updated_at = now(),
               version_lock = version_lock + 1
         WHERE id = $1
        `,
        [run.id, ordinal, `Page ${ordinal} is in status 'failed'.`],
      );
      return {
        ok: true,
        outcome: "page_failed",
        runStatus: "failed",
        currentOrdinal: ordinal,
        pageStatus: "failed",
      };
    }

    // page_status is 'pending' or 'generating' — run the pass loop.
    return await processPagePassLoop(client, run, brief, page, call);
  }
}

async function processPagePassLoop(
  client: Client,
  run: BriefRunRow,
  brief: BriefRow,
  page: BriefPageRow,
  call: AnthropicCallFn,
): Promise<BriefRunTickResult> {
  const isAnchor = page.ordinal === 0;
  const ceiling = isAnchor
    ? BRIEF_ANCHOR_PAGE_CEILING_CENTS
    : BRIEF_PAGE_CEILING_CENTS;

  // Budget reservation. Only reserves on the first tick for this page
  // (when current_pass_kind is null). Subsequent ticks (resume) skip
  // the reserve because it already landed; we rely on the overall
  // monthly cap to bound double-reservations across retries in the
  // edge case where the worker crashed AFTER reserving but BEFORE
  // writing current_pass_kind.
  if (page.current_pass_kind === null) {
    await client.query("BEGIN");
    try {
      const reserve = await reserveWithCeiling(client, brief.site_id, ceiling);
      if (!reserve.ok) {
        await client.query("ROLLBACK");
        if (reserve.code === "BUDGET_EXCEEDED") {
          // Mark the page failed with BUDGET_EXCEEDED so the run's
          // state machine surfaces the error cleanly.
          await client.query(
            `
            UPDATE brief_pages
               SET page_status = 'failed',
                   updated_at = now(),
                   version_lock = version_lock + 1
             WHERE id = $1 AND version_lock = $2
            `,
            [page.id, page.version_lock],
          );
          await client.query(
            `
            UPDATE brief_runs
               SET status = 'failed',
                   failure_code = 'BUDGET_EXCEEDED',
                   failure_detail = $2,
                   finished_at = now(),
                   lease_expires_at = NULL,
                   worker_id = NULL,
                   updated_at = now(),
                   version_lock = version_lock + 1
             WHERE id = $1
            `,
            [run.id, reserve.message],
          );
          return {
            ok: false,
            code: "BUDGET_EXCEEDED",
            message: reserve.message,
            details: {
              period: reserve.period,
              cap_cents: reserve.cap_cents,
              usage_cents: reserve.usage_cents,
            },
          };
        }
        return {
          ok: false,
          code: "INTERNAL_ERROR",
          message: reserve.message,
        };
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
  }

  // Mark page generating + set current ordinal on the run if not set.
  if (page.page_status === "pending") {
    const upd = await client.query(
      `
      UPDATE brief_pages
         SET page_status = 'generating',
             updated_at = now(),
             version_lock = version_lock + 1
       WHERE id = $1 AND version_lock = $2
      `,
      [page.id, page.version_lock],
    );
    if ((upd.rowCount ?? 0) === 0) {
      // Someone edited the page while we were about to start. Run
      // aborts this page with VERSION_CONFLICT surfaced via failure.
      return {
        ok: false,
        code: "VERSION_CONFLICT",
        message:
          "Page was edited between lease and start. Cancel and retry the run.",
      };
    }
    page.page_status = "generating";
    page.version_lock += 1;

    await client.query(
      `
      UPDATE brief_runs
         SET current_ordinal = $2, updated_at = now(), version_lock = version_lock + 1
       WHERE id = $1
      `,
      [run.id, page.ordinal],
    );
  }

  // Load site_conventions if present (pages 1..N read frozen conventions).
  const conventionsRow = await getSiteConventions(brief.id);

  // Resume pointer.
  let kindToRun: BriefPagePassKind | null = null;
  let numberToRun = 0;
  const next = nextPassAfter(
    page.current_pass_kind,
    page.current_pass_number,
    isAnchor,
  );
  if (next === null) {
    // All passes already done but page_status is still generating — drop
    // through to gates.
    kindToRun = null;
    numberToRun = 0;
  } else {
    kindToRun = next.kind;
    numberToRun = next.number;
  }

  // Pass loop — run ONE pass per tick call, or run through to gates
  // in a single tick for MVP throughput. For M12-3 we run the whole
  // page in one tick (one brief_run lease = one page advance). Per-
  // tick pausing between passes is an optimisation deferred to a
  // follow-up — for now we prioritise fewer moving parts.
  let previousDraft: string | null = page.draft_html;
  let previousCritique: string | null =
    (page.critique_log as BriefPageCritiqueEntry[]).find(
      (c) => c.pass_kind === "self_critique",
    )?.output as string | null ?? null;
  // Raw Anthropic text of the anchor's final revise pass. extractDraftHtml
  // strips fenced code blocks out of draft_html (it shouldn't be rendered
  // to WordPress with a stray ```json block), so we stash the raw text
  // here and feed it to extractConventionsFromRevise after the loop.
  let anchorFinalReviseRawText: string | null = null;
  let totalPassesRun = 0;

  while (kindToRun !== null) {
    const standardCap = isAnchor ? STANDARD_TEXT_PASSES + ANCHOR_EXTRA_CYCLES : STANDARD_TEXT_PASSES;
    if (totalPassesRun >= standardCap + 1) {
      // Defensive: shouldn't reach this unless nextPassAfter returns
      // stale values. Bail to avoid an infinite loop.
      logger.error("brief_runner.pass_loop_runaway", {
        brief_run_id: run.id,
        page_id: page.id,
        ordinal: page.ordinal,
      });
      break;
    }

    const ctx: PageContext = {
      brief,
      page,
      contentSummary: run.content_summary,
      siteConventions: conventionsRow ?? null,
      previousDraft,
      previousCritique,
    };

    const isAnchorFinalPass =
      isAnchor &&
      kindToRun === "revise" &&
      numberToRun === ANCHOR_EXTRA_CYCLES;

    let passText: string;
    let response: AnthropicResponse;
    try {
      const out = await runOnePass({
        call,
        ctx,
        passKind: kindToRun,
        passNumber: numberToRun,
        isAnchorFinalPass,
      });
      passText = out.text;
      response = out.response;
      if (isAnchorFinalPass) {
        anchorFinalReviseRawText = passText;
      }
    } catch (err) {
      logger.error("brief_runner.pass_failed", {
        brief_run_id: run.id,
        page_id: page.id,
        ordinal: page.ordinal,
        pass_kind: kindToRun,
        pass_number: numberToRun,
        error: err,
      });
      // Mark the page failed; operator can cancel + re-upload.
      await client.query(
        `
        UPDATE brief_pages
           SET page_status = 'failed',
               current_pass_kind = $2,
               current_pass_number = $3,
               updated_at = now(),
               version_lock = version_lock + 1
         WHERE id = $1
        `,
        [page.id, kindToRun, numberToRun],
      );
      await client.query(
        `
        UPDATE brief_runs
           SET status = 'failed',
               failure_code = 'ANTHROPIC_ERROR',
               failure_detail = $2,
               finished_at = now(),
               lease_expires_at = NULL,
               worker_id = NULL,
               updated_at = now(),
               version_lock = version_lock + 1
         WHERE id = $1
        `,
        [
          run.id,
          err instanceof Error ? err.message : String(err),
        ],
      );
      return {
        ok: true,
        outcome: "page_failed",
        runStatus: "failed",
        currentOrdinal: page.ordinal,
        pageStatus: "failed",
      };
    }

    // Persist the pass result under version_lock CAS.
    const criticalLog = [
      ...(page.critique_log as BriefPageCritiqueEntry[]),
      {
        pass_kind: kindToRun,
        pass_number: numberToRun,
        anthropic_response_id: response.id,
        output:
          kindToRun === "self_critique"
            ? passText
            : extractDraftHtml(passText),
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          cached_tokens:
            (response.usage.cache_read_input_tokens ?? 0) +
            (response.usage.cache_creation_input_tokens ?? 0),
        },
      },
    ];

    const newDraftHtml =
      kindToRun === "self_critique" ? page.draft_html : extractDraftHtml(passText);

    const peek = nextPassAfter(kindToRun, numberToRun, isAnchor);
    const upd = await client.query(
      `
      UPDATE brief_pages
         SET draft_html = $2,
             critique_log = $3::jsonb,
             current_pass_kind = $4,
             current_pass_number = $5,
             updated_at = now(),
             version_lock = version_lock + 1
       WHERE id = $1 AND version_lock = $6
      `,
      [
        page.id,
        newDraftHtml,
        JSON.stringify(criticalLog),
        kindToRun,
        numberToRun,
        page.version_lock,
      ],
    );
    if ((upd.rowCount ?? 0) === 0) {
      return {
        ok: false,
        code: "VERSION_CONFLICT",
        message: `Page ${page.ordinal} was edited mid-pass. Cancel and retry.`,
      };
    }
    // Update the in-memory page so the loop's next iteration reads it.
    page.draft_html = newDraftHtml;
    page.critique_log = criticalLog;
    page.current_pass_kind = kindToRun;
    page.current_pass_number = numberToRun;
    page.version_lock += 1;

    if (kindToRun === "self_critique") {
      previousCritique = passText;
    } else {
      previousDraft = newDraftHtml;
    }

    totalPassesRun += 1;

    if (peek === null) break;
    kindToRun = peek.kind;
    numberToRun = peek.number;
  }

  // All passes done. Run the gate.
  const gate = runGatesForBriefPage(page.draft_html);
  if (!gate.ok) {
    await client.query(
      `
      UPDATE brief_pages
         SET page_status = 'failed',
             updated_at = now(),
             version_lock = version_lock + 1
       WHERE id = $1 AND version_lock = $2
      `,
      [page.id, page.version_lock],
    );
    await client.query(
      `
      UPDATE brief_runs
         SET status = 'failed',
             failure_code = $2,
             failure_detail = $3,
             finished_at = now(),
             lease_expires_at = NULL,
             worker_id = NULL,
             updated_at = now(),
             version_lock = version_lock + 1
       WHERE id = $1
      `,
      [run.id, gate.code ?? "QUALITY_GATE_FAILED", gate.message ?? "Gate failed."],
    );
    return {
      ok: true,
      outcome: "page_failed",
      runStatus: "failed",
      currentOrdinal: page.ordinal,
      pageStatus: "failed",
    };
  }

  // On the anchor page, freeze site_conventions from the final draft.
  // Use the captured raw anthropic text (which still contains the
  // ```json fenced block) — page.draft_html has already had code blocks
  // stripped by extractDraftHtml.
  if (isAnchor) {
    const conventions = extractConventionsFromRevise(
      anchorFinalReviseRawText ?? page.draft_html ?? "",
    );
    const freeze = await freezeSiteConventions({
      briefId: brief.id,
      conventions,
    });
    if (!freeze.ok) {
      // Should only fail on NOT_FOUND (brief vanished) or INTERNAL_ERROR.
      // A VALIDATION_FAILED here means Claude produced garbage; for
      // M12-3 MVP we proceed anyway with an empty conventions row so
      // the run doesn't halt. M12-4 tightens the prompt + validation.
      if (freeze.code === "NOT_FOUND") {
        return {
          ok: false,
          code: "NOT_FOUND",
          message: freeze.message,
        };
      }
      logger.warn("brief_runner.anchor.freeze_non_fatal", {
        brief_run_id: run.id,
        brief_id: brief.id,
        freeze_code: freeze.code,
      });
      const fallback = await freezeSiteConventions({
        briefId: brief.id,
        conventions: {},
      });
      if (!fallback.ok && fallback.code === "NOT_FOUND") {
        return { ok: false, code: "NOT_FOUND", message: fallback.message };
      }
    }
  }

  // Transition to awaiting_review.
  const updAwait = await client.query(
    `
    UPDATE brief_pages
       SET page_status = 'awaiting_review',
           updated_at = now(),
           version_lock = version_lock + 1
     WHERE id = $1 AND version_lock = $2
    `,
    [page.id, page.version_lock],
  );
  if ((updAwait.rowCount ?? 0) === 0) {
    return {
      ok: false,
      code: "VERSION_CONFLICT",
      message: "Page was edited between pass loop and awaiting_review transition.",
    };
  }

  // Pause the run (operator must act).
  await client.query(
    `
    UPDATE brief_runs
       SET status = 'paused',
           current_ordinal = $2,
           lease_expires_at = NULL,
           worker_id = NULL,
           updated_at = now(),
           version_lock = version_lock + 1
     WHERE id = $1
    `,
    [run.id, page.ordinal],
  );

  return {
    ok: true,
    outcome: "page_advanced_to_review",
    runStatus: "paused",
    currentOrdinal: page.ordinal,
    pageStatus: "awaiting_review",
  };
}

// ---------------------------------------------------------------------------
// approveBriefPage — promote draft_html → generated_html, append content
// summary, resume the runner.
//
// Called by the approve route (and tests). Caller must hold the admin
// gate; this function is service-role-only and bypasses RLS.
// ---------------------------------------------------------------------------

export type ApprovePageInput = {
  pageId: string;
  expectedVersionLock: number;
  approvedBy: string | null;
  summaryAddendum?: string; // what to append to brief_runs.content_summary
};

export type ApprovePageResult =
  | { ok: true; pageStatus: "approved"; runStatus: BriefRunRow["status"] }
  | {
      ok: false;
      code: "NOT_FOUND" | "INVALID_STATE" | "VERSION_CONFLICT" | "INTERNAL_ERROR";
      message: string;
    };

export async function approveBriefPage(
  input: ApprovePageInput,
): Promise<ApprovePageResult> {
  const svc = getServiceRoleClient();

  // Read page + brief_run state.
  const pageRes = await svc
    .from("brief_pages")
    .select("id, brief_id, ordinal, page_status, draft_html, version_lock")
    .eq("id", input.pageId)
    .is("deleted_at", null)
    .maybeSingle();
  if (pageRes.error) {
    logger.error("approve.page_lookup_failed", {
      page_id: input.pageId,
      error: pageRes.error,
    });
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "Failed to look up brief_page.",
    };
  }
  if (!pageRes.data) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: `No brief_page ${input.pageId}.`,
    };
  }
  const page = pageRes.data as {
    id: string;
    brief_id: string;
    ordinal: number;
    page_status: BriefPageStatus;
    draft_html: string | null;
    version_lock: number;
  };

  if (page.page_status !== "awaiting_review") {
    return {
      ok: false,
      code: "INVALID_STATE",
      message: `Page is in status '${page.page_status}', not 'awaiting_review'.`,
    };
  }
  if (page.draft_html === null || page.draft_html.trim() === "") {
    return {
      ok: false,
      code: "INVALID_STATE",
      message: "Page has no draft_html to promote.",
    };
  }

  // Promote draft_html → generated_html + set approved_at/by under CAS.
  const nowIso = new Date().toISOString();
  const upd = await svc
    .from("brief_pages")
    .update({
      page_status: "approved",
      generated_html: page.draft_html,
      approved_at: nowIso,
      approved_by: input.approvedBy,
      updated_at: nowIso,
      updated_by: input.approvedBy,
      version_lock: input.expectedVersionLock + 1,
    })
    .eq("id", page.id)
    .eq("version_lock", input.expectedVersionLock)
    .select("id")
    .maybeSingle();
  if (upd.error) {
    logger.error("approve.update_failed", {
      page_id: input.pageId,
      error: upd.error,
    });
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "Failed to promote draft_html to generated_html.",
    };
  }
  if (!upd.data) {
    return {
      ok: false,
      code: "VERSION_CONFLICT",
      message: "Page was edited while you were reviewing. Refresh and retry.",
    };
  }

  // Append to brief_run content_summary + transition run back to queued
  // so the next tick picks up ordinal+1.
  const runRes = await svc
    .from("brief_runs")
    .select("id, content_summary, version_lock")
    .eq("brief_id", page.brief_id)
    .in("status", ["paused", "running", "queued"])
    .maybeSingle();
  if (runRes.error) {
    logger.error("approve.run_lookup_failed", {
      brief_id: page.brief_id,
      error: runRes.error,
    });
    // Page is approved; run state isn't critical to the approve contract.
    // Return success; the next runner tick will surface any drift.
    return { ok: true, pageStatus: "approved", runStatus: "paused" };
  }
  if (!runRes.data) {
    return { ok: true, pageStatus: "approved", runStatus: "paused" };
  }

  const runSnap = runRes.data as {
    id: string;
    content_summary: string;
    version_lock: number;
  };
  const nextContentSummary = appendToContentSummary(
    runSnap.content_summary,
    input.summaryAddendum ??
      `Page ${page.ordinal + 1} approved (ordinal ${page.ordinal}).`,
  );

  const runUpd = await svc
    .from("brief_runs")
    .update({
      status: "queued",
      content_summary: nextContentSummary,
      current_ordinal: page.ordinal + 1,
      updated_at: nowIso,
      version_lock: runSnap.version_lock + 1,
    })
    .eq("id", runSnap.id)
    .eq("version_lock", runSnap.version_lock)
    .select("status")
    .maybeSingle();

  if (runUpd.error || !runUpd.data) {
    // Page is approved; run state is inconsistent. A later tick will
    // re-read current_ordinal from the page graph and resume correctly
    // (advance_one_step loops past approved pages).
    logger.warn("approve.run_requeue_failed", {
      run_id: runSnap.id,
      page_id: page.id,
      error: runUpd.error,
    });
    return { ok: true, pageStatus: "approved", runStatus: "paused" };
  }

  return {
    ok: true,
    pageStatus: "approved",
    runStatus: (runUpd.data as { status: BriefRunRow["status"] }).status,
  };
}
