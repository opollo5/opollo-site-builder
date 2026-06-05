// No "server-only" import — this module is used as a CLI script via tsx.
// Uses createClient directly (not lib/supabase.ts) to avoid the server-only barrier.
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

function getSvc() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function resolveSignedUrl(objectPath: string): Promise<string | null> {
  const svc = getSvc();
  const { data, error } = await svc.storage
    .from("feedback-screenshots")
    .createSignedUrl(objectPath, 3600);
  return error ? null : (data?.signedUrl ?? null);
}

const logger = {
  info: (msg: string, fields?: object) => console.log(JSON.stringify({ level: "info", msg, ...fields })),
  error: (msg: string, fields?: object) => console.error(JSON.stringify({ level: "error", msg, ...fields })),
};

// ---------------------------------------------------------------------------
// bugs:pull — Supabase → docs/bugs/<slug>.md
//
// Fetches all non-deleted tickets in {backlog, triaged, in_progress} status,
// ordered by priority desc then severity desc so the agent works on the most
// important bugs first. Writes/updates docs/bugs/<slug>.md idempotently.
// Sets repo_ref on the ticket the first time a file is written.
// ---------------------------------------------------------------------------

const BUGS_DIR = path.join(process.cwd(), "docs", "bugs");
const ACTIVE_STATUSES = ["backlog", "triaged", "in_progress"];

const PRIORITY_SORT: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
const SEVERITY_SORT: Record<string, number> = { blocker: 4, high: 3, normal: 2, low: 1 };

function slugify(title: string, id: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${base}-${id.slice(0, 8)}`;
}

function formatConsoleErrors(errors: unknown): string {
  if (!errors || !Array.isArray(errors) || errors.length === 0) return "_None_";
  return (errors as Array<{ level?: string; msg?: string; at?: string }>)
    .map((e) => `- [${e.level ?? "error"}] ${e.msg ?? ""} (${e.at ?? ""})`)
    .join("\n");
}

type DebugEvent = { ts: number; method: string; path: string; status: number; requestId?: string | null; durationMs: number };
type DebugSnapshotRow = {
  buildSha?: string | null;
  route?: string;
  vercelEnv?: string | null;
  userEmail?: string | null;
  userAgent?: string;
  viewport?: { w: number; h: number; dpr: number };
  apiEvents?: DebugEvent[];
};

function formatDebugSnapshot(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "_No debug snapshot_";
  const snap = raw as DebugSnapshotRow;
  const lines: string[] = [];
  lines.push(`- build-sha: ${snap.buildSha ?? "(unset)"}`);
  lines.push(`- route: ${snap.route ?? "(unknown)"}`);
  lines.push(`- vercel-env: ${snap.vercelEnv ?? "(unset)"}`);
  lines.push(`- user: ${snap.userEmail ?? "(unknown)"}`);
  if (snap.userAgent) lines.push(`- ua: ${snap.userAgent}`);
  if (snap.viewport) {
    lines.push(`- viewport: ${snap.viewport.w}×${snap.viewport.h} dpr=${snap.viewport.dpr}`);
  }
  const events = snap.apiEvents ?? [];
  if (events.length > 0) {
    lines.push("");
    lines.push(`Recent API events (${events.length}):`);
    for (const e of events.slice(-10)) {
      const age = Math.round((Date.now() - e.ts) / 1000);
      lines.push(
        `  ${e.method.padEnd(6)} ${String(e.status).padStart(3)} ${e.durationMs}ms ${e.path} (${age}s ago)`,
      );
    }
  }
  return lines.join("\n");
}

function formatComments(
  comments: Array<{ is_staff: boolean; body: string; created_at: string }>,
): string {
  if (comments.length === 0) return "_No messages yet._";
  return comments
    .map(
      (c) =>
        `**${c.is_staff ? "Opollo" : "Reporter"}** (${c.created_at.slice(0, 10)}):\n${c.body}`,
    )
    .join("\n\n");
}

export async function pullBugs(): Promise<{ written: number; errors: number }> {
  const svc = getSvc();
  let written = 0;
  let errors = 0;

  // Fetch tickets with comments.
  const { data: tickets, error } = await svc
    .from("feedback_tickets")
    .select("*, feedback_ticket_comments(id, is_staff, body, author_id, created_at)")
    .in("status", ACTIVE_STATUSES)
    .is("deleted_at", null);

  if (error) {
    logger.error("bugs.pull.query_failed", { err: error.message });
    return { written: 0, errors: 1 };
  }

  // Sort by priority desc, severity desc.
  const sorted = (tickets ?? []).sort(
    (a, b) =>
      (PRIORITY_SORT[b.priority] ?? 0) - (PRIORITY_SORT[a.priority] ?? 0) ||
      (SEVERITY_SORT[b.severity] ?? 0) - (SEVERITY_SORT[a.severity] ?? 0),
  );

  // Ensure docs/bugs/ exists.
  fs.mkdirSync(BUGS_DIR, { recursive: true });

  // Also fetch platform_users for reporter email.
  const reporterIds = [...new Set(sorted.map((t) => t.created_by as string))];
  const { data: users } = await svc
    .from("platform_users")
    .select("id, email")
    .in("id", reporterIds);
  const userEmailMap = new Map(
    (users ?? []).map((u) => [u.id as string, u.email as string]),
  );

  for (const ticket of sorted) {
    // §3 v1.3: use description first-line as slug base; ticket_number in frontmatter.
    const descFirstLine = (ticket.description as string).split("\n")[0].slice(0, 60);
    const slug = slugify(descFirstLine, ticket.id as string);
    const filePath = path.join(BUGS_DIR, `${slug}.md`);
    const isFirst = !(ticket.repo_ref as string | null);

    // Resolve screenshot signed URL (best-effort).
    let screenshotUrl = "_No screenshot_";
    if (ticket.screenshot_path) {
      const url = await resolveSignedUrl(ticket.screenshot_path as string);
      if (url) screenshotUrl = url;
    }

    const reporterEmail = userEmailMap.get(ticket.created_by as string) ?? "unknown";

    const comments = (
      ticket.feedback_ticket_comments as Array<{
        is_staff: boolean;
        body: string;
        created_at: string;
      }>
    ) ?? [];

    const ticketNum = (ticket.ticket_number as number | null) ?? null;
    const content = `---
ticket_id: ${ticket.id}
ticket_number: ${ticketNum !== null ? `#${ticketNum}` : "null"}
slug: ${slug}
status: ${ticket.status}
severity: ${ticket.severity}
priority: ${ticket.priority}
company: ${ticket.company_id}
assignee: ${(ticket.assignee_id as string | null) ?? "unassigned"}
route: ${(ticket.route_pattern as string | null) ?? ticket.page_url}
page_url: ${ticket.page_url}
selector: '${ticket.css_selector}'
click_pct: { x: ${ticket.click_x_pct}, y: ${ticket.click_y_pct} }
viewport: { w: ${ticket.viewport_w}, h: ${ticket.viewport_h} }
screenshot: ${screenshotUrl}
reported_by: ${reporterEmail}
reported_at: ${ticket.created_at}
linked_pr_url: ${(ticket.linked_pr_url as string | null) ?? "null"}
---

## What happened

${ticket.description}

## What was expected

${(ticket.expected_behavior as string | null) ?? "_Not specified_"}

## Console errors

${formatConsoleErrors(ticket.console_errors)}

## Debug Snapshot

${formatDebugSnapshot(ticket.debug_snapshot)}

## Thread (read-only mirror — reply in-app, not here)

${formatComments(comments)}

## Resolution (filled by Claude Code — CLAUDE.md report-back template)
<!-- Working analog: <file>:<lines> — … / Diff: … / Fix: … -->
`;

    try {
      fs.writeFileSync(filePath, content, "utf-8");
      written += 1;
      logger.info("bugs.pull.written", { slug, ticket_id: ticket.id });

      // Set repo_ref on first write.
      if (isFirst) {
        await svc
          .from("feedback_tickets")
          .update({ repo_ref: `docs/bugs/${slug}.md` })
          .eq("id", ticket.id as string);
      }
    } catch (writeErr) {
      logger.error("bugs.pull.write_failed", {
        slug,
        ticket_id: ticket.id,
        err: String(writeErr),
      });
      errors += 1;
    }
  }

  return { written, errors };
}
