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
    const slug = slugify(ticket.title as string, ticket.id as string);
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

    const content = `---
ticket_id: ${ticket.id}
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
