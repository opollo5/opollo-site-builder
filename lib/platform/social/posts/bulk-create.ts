import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

import type { PostMaster } from "./types";

// ---------------------------------------------------------------------------
// S7 — bulk insert social_post_master rows from CSV upload.
//
// Validates each row first (same rules as createPostMaster), then inserts
// the valid rows in a single PostgREST batch call. Rows that fail
// validation are returned as per-row errors so the caller can surface
// them to the user without aborting the whole upload.
//
// PostgREST batch insert requirement (from MEMORY.md): every row in the
// insert array must spell out EVERY column; PostgREST sends NULL for any
// missing key, which would violate NOT NULL constraints on `company_id`,
// `state`, and `source_type`.
// ---------------------------------------------------------------------------

export const ROW_LIMIT = 100;
const MASTER_TEXT_MAX = 10_000;
const LINK_URL_MAX = 2048;

export interface BulkCsvRow {
  masterText: string | null;
  linkUrl: string | null;
}

export interface BulkRowError {
  row: number; // 1-based, excluding the header row
  message: string;
}

export interface BulkCreateResult {
  created: PostMaster[];
  errors: BulkRowError[];
}

export async function bulkCreatePostMasters(
  companyId: string,
  rows: BulkCsvRow[],
  createdBy: string | null,
): Promise<BulkCreateResult> {
  const validIndices: number[] = [];
  const errors: BulkRowError[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNum = i + 1;

    const text =
      row.masterText && row.masterText.trim().length > 0
        ? row.masterText.trim()
        : null;
    const link =
      row.linkUrl && row.linkUrl.trim().length > 0
        ? row.linkUrl.trim()
        : null;

    if (text === null && link === null) {
      errors.push({ row: rowNum, message: "Row has no content: both master_text and link_url are empty." });
      continue;
    }
    if (text !== null && text.length > MASTER_TEXT_MAX) {
      errors.push({ row: rowNum, message: `master_text exceeds ${MASTER_TEXT_MAX} characters.` });
      continue;
    }
    if (link !== null) {
      if (link.length > LINK_URL_MAX) {
        errors.push({ row: rowNum, message: `link_url exceeds ${LINK_URL_MAX} characters.` });
        continue;
      }
      if (!isHttpUrl(link)) {
        errors.push({ row: rowNum, message: `link_url "${link.slice(0, 80)}" is not a valid http(s) URL.` });
        continue;
      }
    }

    validIndices.push(i);
  }

  if (validIndices.length === 0) {
    return { created: [], errors };
  }

  // Spell out every column on every row — PostgREST batch insert sends
  // NULL for any key missing from a row; violates NOT NULL on company_id /
  // state / source_type silently (see MEMORY.md PostgREST batch insert rule).
  const inserts = validIndices.map((i) => {
    const row = rows[i]!;
    return {
      company_id: companyId,
      state: "draft" as const,
      source_type: "csv" as const,
      master_text: row.masterText?.trim() ?? null,
      link_url: row.linkUrl?.trim() ?? null,
      created_by: createdBy,
    };
  });

  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("social_post_master")
    .insert(inserts)
    .select(
      "id, company_id, state, source_type, master_text, link_url, created_by, created_at, updated_at, state_changed_at",
    );

  if (error) {
    logger.error("social.posts.bulk-create.failed", {
      companyId,
      rowCount: inserts.length,
      err: error.message,
      code: error.code,
    });
    // Mark all valid rows as failed — batch errors are systematic.
    const batchErrors: BulkRowError[] = validIndices.map((i) => ({
      row: i + 1,
      message: `Database error: ${error.message}`,
    }));
    return { created: [], errors: [...errors, ...batchErrors] };
  }

  // Verify Supabase returned data (it should — select is attached).
  if (!data) {
    logger.error("social.posts.bulk-create.no-data", { companyId });
    const batchErrors: BulkRowError[] = validIndices.map((i) => ({
      row: i + 1,
      message: "Insert succeeded but no rows returned.",
    }));
    return { created: [], errors: [...errors, ...batchErrors] };
  }

  logger.info("social.posts.bulk-create.complete", {
    companyId,
    inserted: data.length,
    validationErrors: errors.length,
  });

  return { created: data as PostMaster[], errors };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
