// No "server-only" import — this module is also used as a CLI script via tsx.
import * as fs from "node:fs";
import * as path from "node:path";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// bugs:push — docs/bugs/<slug>.md status/PR → Supabase (impl status only).
//
// Reads all .md files in docs/bugs/, parses front-matter, and writes back:
//   - status ∈ {in_progress, fixed}    (§10: no terminal states)
//   - linked_pr_url
//
// Terminal states (verified, closed, wont_fix) are REJECTED — the governance
// contract (§1) requires humans to close tickets.
// ---------------------------------------------------------------------------

const BUGS_DIR = path.join(process.cwd(), "docs", "bugs");
const ALLOWED_STATUSES = new Set(["in_progress", "fixed"]);

type ParsedFrontmatter = {
  ticket_id: string | null;
  status: string | null;
  linked_pr_url: string | null;
};

function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { ticket_id: null, status: null, linked_pr_url: null };
  const block = match[1];
  const get = (key: string): string | null => {
    const m = block.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return m ? m[1].trim().replace(/^null$/, "").trim() || null : null;
  };
  return {
    ticket_id: get("ticket_id"),
    status: get("status"),
    linked_pr_url: get("linked_pr_url"),
  };
}

export async function pushBugs(): Promise<{
  updated: number;
  skipped: number;
  rejected: number;
  errors: number;
}> {
  const svc = getServiceRoleClient();
  let updated = 0;
  let skipped = 0;
  let rejected = 0;
  let errors = 0;

  if (!fs.existsSync(BUGS_DIR)) {
    logger.warn("bugs.push.bugs_dir_missing", { dir: BUGS_DIR });
    return { updated, skipped, rejected, errors };
  }

  const files = fs.readdirSync(BUGS_DIR).filter((f) => f.endsWith(".md") && f !== ".gitkeep");

  for (const file of files) {
    const filePath = path.join(BUGS_DIR, file);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch (readErr) {
      logger.error("bugs.push.read_failed", { file, err: String(readErr) });
      errors += 1;
      continue;
    }

    const { ticket_id, status, linked_pr_url } = parseFrontmatter(content);

    if (!ticket_id) {
      logger.warn("bugs.push.no_ticket_id", { file });
      skipped += 1;
      continue;
    }

    // Guard: automation may NOT write terminal states.
    if (status && !ALLOWED_STATUSES.has(status)) {
      logger.error("bugs.push.terminal_state_rejected", {
        file,
        ticket_id,
        rejected_status: status,
      });
      rejected += 1;
      continue;
    }

    const updates: Record<string, string | null> = {};
    if (status && ALLOWED_STATUSES.has(status)) updates.status = status;
    if (linked_pr_url) updates.linked_pr_url = linked_pr_url;

    if (Object.keys(updates).length === 0) {
      skipped += 1;
      continue;
    }

    const { error } = await svc
      .from("feedback_tickets")
      .update(updates)
      .eq("id", ticket_id);

    if (error) {
      logger.error("bugs.push.update_failed", {
        file,
        ticket_id,
        err: error.message,
      });
      errors += 1;
      continue;
    }

    logger.info("bugs.push.updated", { file, ticket_id, updates });
    updated += 1;
  }

  return { updated, skipped, rejected, errors };
}
