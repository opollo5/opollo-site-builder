import "server-only";

import { createHash } from "node:crypto";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

import { fetchSourcePage } from "./fetch-source";

// ---------------------------------------------------------------------------
// OPTIMISER PHASE 1.5 SLICE 17 — Page-import brief submission.
//
// Operator (or onboarding "Try auto-import" button) provides a URL.
// We:
//   1. Fetch the live HTML.
//   2. Insert a briefs row (status='committed') + brief_pages row
//      (mode='import', source_text=fetched HTML, import_source_url
//      set) + brief_runs row (status='queued').
//   3. Return the run id for the UI to poll.
//
// The brief-runner consumer of mode='import' is intentionally NOT
// in this slice. When the runner integration lands, it reads the
// source HTML out of source_text, prompts Anthropic with the client's
// site_conventions + the source as context, and runs the standard
// multi-pass + visual review pipeline.
//
// Once the operator approves the imported page in the proposal review
// surface, the existing page-acceptance flow flips
// opt_landing_pages.management_mode → 'full_automation' and sets
// page_id. From there, slice 15's submit-brief works against this
// page like any other automated landing page.
// ---------------------------------------------------------------------------

export interface SubmitImportInput {
  url: string;
  /** Owning client (for site_conventions lookup at runtime). */
  client_id: string;
  /** Optional landing page id this import targets. NULL when the
   *  operator is bootstrapping a new page during onboarding. */
  landing_page_id: string | null;
  /** Operator user id for audit columns. */
  actor_user_id: string | null;
  /** Optional brief title; defaults to "Import: {hostname}/{path}". */
  title?: string;
  /** Site to file the brief under. The Site Builder requires a
   *  site_id; for new-client onboarding the caller supplies the
   *  shared placeholder site that the onboarding flow uses. */
  site_id: string;
}

export type SubmitImportResult =
  | {
      ok: true;
      brief_id: string;
      brief_run_id: string;
      source: {
        url: string;
        final_url: string;
        body_size: number;
      };
    }
  | {
      ok: false;
      error: { code: string; message: string };
    };

export async function submitPageImport(
  input: SubmitImportInput,
): Promise<SubmitImportResult> {
  const fetched = await fetchSourcePage({ url: input.url });
  if (!fetched.ok) {
    return fetched;
  }

  const supabase = getServiceRoleClient();
  const sourceText = fetched.html;
  const sourceSha = createHash("sha256").update(sourceText).digest("hex");
  const wordCount = sourceText
    .replace(/<[^>]+>/g, " ")
    .split(/\s+/)
    .filter((s) => s.length > 0).length;
  const idempotencyKey = `optimiser:import:${input.client_id}:${sourceSha.slice(0, 16)}`;
  const title =
    input.title ??
    `Import: ${friendlyTitleFromUrl(fetched.final_url)}`;

  let briefId: string | null = null;
  try {
    const briefRes = await supabase
      .from("briefs")
      .insert({
        site_id: input.site_id,
        title,
        status: "committed",
        source_storage_path: `optimiser-import/${input.client_id}/${sourceSha.slice(0, 16)}`,
        source_mime_type: "text/markdown",
        source_size_bytes: Buffer.byteLength(sourceText, "utf8"),
        source_sha256: sourceSha,
        upload_idempotency_key: idempotencyKey,
        parser_mode: "structural",
        parser_warnings: [],
        committed_at: new Date().toISOString(),
        committed_by: input.actor_user_id,
        committed_page_hash: sourceSha,
        created_by: input.actor_user_id,
        updated_by: input.actor_user_id,
      })
      .select("id")
      .single();
    if (briefRes.error || !briefRes.data) {
      throw new Error(`briefs insert: ${briefRes.error?.message ?? "no row"}`);
    }
    briefId = briefRes.data.id as string;

    const pageRes = await supabase.from("brief_pages").insert({
      brief_id: briefId,
      ordinal: 0,
      title,
      mode: "import",
      source_text: sourceText,
      word_count: wordCount,
      import_source_url: fetched.final_url,
      created_by: input.actor_user_id,
      updated_by: input.actor_user_id,
    });
    if (pageRes.error) {
      throw new Error(`brief_pages insert: ${pageRes.error.message}`);
    }

    const runRes = await supabase
      .from("brief_runs")
      .insert({
        brief_id: briefId,
        status: "queued",
        created_by: input.actor_user_id,
        updated_by: input.actor_user_id,
      })
      .select("id")
      .single();
    if (runRes.error || !runRes.data) {
      throw new Error(`brief_runs insert: ${runRes.error?.message ?? "no row"}`);
    }

    return {
      ok: true,
      brief_id: briefId,
      brief_run_id: runRes.data.id as string,
      source: {
        url: fetched.url,
        final_url: fetched.final_url,
        body_size: fetched.body_size,
      },
    };
  } catch (err) {
    if (briefId !== null) {
      try {
        await supabase.from("briefs").delete().eq("id", briefId);
      } catch (cleanupErr) {
        logger.error("submit-import: cleanup delete failed", {
          brief_id: briefId,
          err:
            cleanupErr instanceof Error
              ? cleanupErr.message
              : String(cleanupErr),
        });
      }
    }
    return {
      ok: false,
      error: {
        code: "BRIEF_INSERT_FAILED",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

function friendlyTitleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, "");
    return `${u.hostname}${path || "/"}`;
  } catch {
    return url;
  }
}
