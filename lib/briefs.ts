import { createHash, randomUUID } from "node:crypto";

import { estimateBriefRunCostCents } from "@/lib/anthropic-pricing";
import { parseBriefDocument, type BriefPageDraft, type ParserWarning } from "@/lib/brief-parser";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse, ErrorCode } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// M12-1 — briefs lib.
//
// Owns the Storage write → DB insert → parser run contract for uploads,
// plus the commit transition (parsed → committed) under page_hash
// idempotency.
//
// All callers go through the admin API gate before reaching here; this
// module uses the service-role Supabase client throughout. RLS is
// defence-in-depth, not the authorisation boundary.
// ---------------------------------------------------------------------------

export const BRIEF_STORAGE_BUCKET = "site-briefs";
export const BRIEF_MAX_BYTES = 10 * 1024 * 1024; // 10 MB (matches CHECK on briefs.source_size_bytes).
export const BRIEF_MAX_CONTENT_TOKENS = 60_000; // Approximate cap per parent plan §Whole-doc context.
export const BRIEF_ALLOWED_MIME_TYPES = ["text/plain", "text/markdown"] as const;
export type BriefMimeType = (typeof BRIEF_ALLOWED_MIME_TYPES)[number];

export type BriefRow = {
  id: string;
  site_id: string;
  title: string;
  status: "parsing" | "parsed" | "committed" | "failed_parse";
  source_storage_path: string;
  source_mime_type: BriefMimeType;
  source_size_bytes: number;
  source_sha256: string;
  upload_idempotency_key: string;
  parser_mode: "structural" | "claude_inference" | null;
  parser_warnings: ParserWarning[];
  parse_failure_code: string | null;
  parse_failure_detail: string | null;
  committed_at: string | null;
  committed_by: string | null;
  committed_page_hash: string | null;
  // M12-2 — first-class fields for the operator-authored brand voice +
  // design direction that feed the M12-3 runner + anchor cycle. Nullable;
  // populated on the review page pre-commit (see commitBrief input).
  brand_voice: string | null;
  design_direction: string | null;
  // M12-4 — per-brief model tier. Defaults to claude-sonnet-4-6 for both
  // via migration 0020. Allowlist-guarded at runner start (see
  // lib/anthropic-pricing.ts::isAllowedAnthropicModel) so an unknown
  // value surfaces as INVALID_MODEL without firing the call.
  text_model: string;
  visual_model: string;
  // M13-3 — routes the runner's dispatch between 'page' mode (anchor
  // cycle on ordinal 0, standard quality gates) and 'post' mode
  // (anchor cycle disabled, post-specific quality gates). Defaults to
  // 'page' at the schema layer (migration 0021) so every pre-M13
  // brief folds in unchanged.
  content_type: "page" | "post";
  version_lock: number;
  created_at: string;
  updated_at: string;
};

export type BriefPageStatus =
  | "pending"
  | "generating"
  | "awaiting_review"
  | "approved"
  | "failed"
  | "skipped";

// M12-5 — client-safe snapshot of the brief_runs row. Subset of the
// server-only BriefRunRow in lib/brief-runner.ts; the columns the run
// surface page reads + the client component renders.
export type BriefRunSnapshot = {
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
  content_summary: string;
  run_cost_cents: number;
  failure_code: string | null;
  failure_detail: string | null;
  cancel_requested_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  version_lock: number;
  created_at: string;
  updated_at: string;
};

export type BriefPagePassKind =
  | "draft"
  | "self_critique"
  | "revise"
  // M12-4 — visual review loop.
  | "visual_critique"
  | "visual_revise";

// M12-4 — set on brief_pages when the visual review loop halted without
// converging. See docs/plans/m12-parent.md §Cost controls + Risk #13.
export type BriefPageQualityFlag = "cost_ceiling" | "capped_with_issues";

export type BriefPageCritiqueEntry = {
  pass_kind: BriefPagePassKind;
  pass_number: number;
  anthropic_response_id: string | null;
  output: unknown;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cached_tokens?: number;
  };
  // M12-4 — integer cents charged for this pass. Computed via
  // lib/anthropic-pricing.ts::computeCostCents. Persisted alongside
  // the critique log so operator-facing cost rollup doesn't need to
  // rebuild from brief_pages.page_cost_cents alone.
  cost_cents?: number;
};

export type BriefPageRow = {
  id: string;
  brief_id: string;
  ordinal: number;
  title: string;
  slug_hint: string | null;
  mode: "full_text" | "short_brief" | "import";
  source_span_start: number | null;
  source_span_end: number | null;
  source_text: string;
  word_count: number;
  operator_notes: string | null;
  version_lock: number;
  // M12-3 — runner state.
  page_status: BriefPageStatus;
  current_pass_kind: BriefPagePassKind | null;
  current_pass_number: number;
  draft_html: string | null;
  generated_html: string | null;
  critique_log: BriefPageCritiqueEntry[];
  approved_at: string | null;
  approved_by: string | null;
  // M12-4 — cost accounting + quality flag.
  page_cost_cents: number;
  quality_flag: BriefPageQualityFlag | null;
};

export type UploadBriefInput = {
  siteId: string;
  title: string;
  bytes: Uint8Array;
  mimeType: BriefMimeType;
  uploadedBy: string | null;
  clientIdempotencyKey?: string;
  // UAT-smoke-1 — operator selects content_type at upload time.
  // Defaults to 'page' (matches the briefs.content_type column default
  // from migration 0021).
  contentType?: "page" | "post";
};

export type UploadBriefData = {
  brief_id: string;
  site_id: string;
  status: BriefRow["status"];
  parser_mode: BriefRow["parser_mode"];
  review_url: string;
  replay: boolean;
};

function now(): string {
  return new Date().toISOString();
}

function errorEnvelope<T = never>(
  code: ErrorCode,
  message: string,
  opts: { details?: Record<string, unknown>; retryable?: boolean; suggested_action?: string } = {},
): ApiResponse<T> {
  return {
    ok: false,
    error: {
      code,
      message,
      details: opts.details,
      retryable: opts.retryable ?? false,
      suggested_action: opts.suggested_action ?? "",
    },
    timestamp: now(),
  };
}

function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function computeUploadIdempotencyKey(opts: {
  siteId: string;
  uploadedBy: string | null;
  fileSha256: string;
}): string {
  const payload = `${opts.siteId}:${opts.uploadedBy ?? "anonymous"}:${opts.fileSha256}`;
  return createHash("sha256").update(payload).digest("hex").slice(0, 64);
}

function briefStoragePath(siteId: string, briefId: string): string {
  return `${siteId}/${briefId}.md`;
}

export function briefReviewUrl(siteId: string, briefId: string): string {
  return `/admin/sites/${siteId}/briefs/${briefId}/review`;
}

// Rough token approximation: chars / 4. Conservative upper bound — the
// post-parse check exists to prevent a downstream BRIEF_TOO_LARGE on
// the runner; precision isn't load-bearing.
function approxTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// uploadBrief — Storage write + DB insert + in-band parser run.
// ---------------------------------------------------------------------------

export async function uploadBrief(
  input: UploadBriefInput,
): Promise<ApiResponse<UploadBriefData>> {
  try {
    return await uploadBriefImpl(input);
  } catch (err) {
    return errorEnvelope("INTERNAL_ERROR", `uploadBrief threw: ${
      err instanceof Error ? err.message : String(err)
    }`);
  }
}

async function uploadBriefImpl(
  input: UploadBriefInput,
): Promise<ApiResponse<UploadBriefData>> {
  const svc = getServiceRoleClient();

  // 0. Guardrails the route already enforces, re-checked here as
  // defence-in-depth.
  if (input.bytes.byteLength === 0) {
    return errorEnvelope("BRIEF_EMPTY", "Brief file is empty.");
  }
  if (input.bytes.byteLength > BRIEF_MAX_BYTES) {
    return errorEnvelope("BRIEF_TOO_LARGE", `Brief exceeds the ${BRIEF_MAX_BYTES}-byte cap.`);
  }
  if (!BRIEF_ALLOWED_MIME_TYPES.includes(input.mimeType)) {
    return errorEnvelope("BRIEF_UNSUPPORTED_TYPE", `Unsupported MIME type: ${input.mimeType}.`);
  }

  // Site exists + not soft-deleted.
  const siteLookup = await svc
    .from("sites")
    .select("id")
    .eq("id", input.siteId)
    .neq("status", "removed")
    .maybeSingle();
  if (siteLookup.error) {
    return errorEnvelope("INTERNAL_ERROR", "Failed to look up site.", {
      details: { supabase_error: siteLookup.error },
    });
  }
  if (!siteLookup.data) {
    return errorEnvelope("NOT_FOUND", `No active site with id ${input.siteId}.`);
  }

  // 1. Compute SHA256 + idempotency key.
  const fileSha256 = sha256Hex(input.bytes);
  const idempotencyKey =
    input.clientIdempotencyKey ??
    computeUploadIdempotencyKey({
      siteId: input.siteId,
      uploadedBy: input.uploadedBy,
      fileSha256,
    });

  // 2. Check for replay.
  const existing = await svc
    .from("briefs")
    .select("*")
    .eq("upload_idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing.error) {
    return errorEnvelope("INTERNAL_ERROR", "Failed to query existing briefs.", {
      details: { supabase_error: existing.error },
    });
  }
  if (existing.data) {
    const row = existing.data as BriefRow;
    if (row.source_sha256 !== fileSha256) {
      return errorEnvelope(
        "IDEMPOTENCY_KEY_CONFLICT",
        "That idempotency key is already in use for a different file.",
        { details: { brief_id: row.id } },
      );
    }
    return {
      ok: true,
      data: {
        brief_id: row.id,
        site_id: row.site_id,
        status: row.status,
        parser_mode: row.parser_mode,
        review_url: briefReviewUrl(row.site_id, row.id),
        replay: true,
      },
      timestamp: now(),
    };
  }

  // 3. Upload to Storage. Pre-generate brief id so the path can be set
  // on the INSERT row.
  const briefId = randomUUID();
  const storagePath = briefStoragePath(input.siteId, briefId);

  const upload = await svc.storage.from(BRIEF_STORAGE_BUCKET).upload(
    storagePath,
    input.bytes,
    {
      contentType: input.mimeType,
      upsert: true, // retry path re-writes the same key deterministically
    },
  );
  if (upload.error) {
    return errorEnvelope("INTERNAL_ERROR", "Storage upload failed.", {
      details: { storage_error: upload.error.message },
    });
  }

  // 4. INSERT briefs row with status='parsing'.
  const defaultTitle = input.title.length > 0 ? input.title.slice(0, 200) : "Untitled brief";
  const insertRow: Record<string, unknown> = {
    id: briefId,
    site_id: input.siteId,
    title: defaultTitle,
    status: "parsing",
    source_storage_path: storagePath,
    source_mime_type: input.mimeType,
    source_size_bytes: input.bytes.byteLength,
    source_sha256: fileSha256,
    upload_idempotency_key: idempotencyKey,
    created_by: input.uploadedBy,
    updated_by: input.uploadedBy,
  };
  if (input.contentType) {
    insertRow.content_type = input.contentType;
  }
  const insert = await svc
    .from("briefs")
    .insert(insertRow)
    .select("*")
    .single();

  if (insert.error || !insert.data) {
    // 23505 race: a concurrent upload landed the same idempotency key
    // between our SELECT and our INSERT. Re-read and replay.
    if (insert.error?.code === "23505") {
      const again = await svc
        .from("briefs")
        .select("*")
        .eq("upload_idempotency_key", idempotencyKey)
        .maybeSingle();
      if (again.data) {
        const row = again.data as BriefRow;
        if (row.source_sha256 === fileSha256) {
          return {
            ok: true,
            data: {
              brief_id: row.id,
              site_id: row.site_id,
              status: row.status,
              parser_mode: row.parser_mode,
              review_url: briefReviewUrl(row.site_id, row.id),
              replay: true,
            },
            timestamp: now(),
          };
        }
        return errorEnvelope(
          "IDEMPOTENCY_KEY_CONFLICT",
          "That idempotency key is already in use for a different file.",
        );
      }
    }
    return errorEnvelope("INTERNAL_ERROR", "Failed to insert brief row.", {
      details: { supabase_error: insert.error ?? null },
    });
  }

  // 5. Parse synchronously.
  const sourceText = new TextDecoder("utf-8", { fatal: false }).decode(input.bytes);
  const parseResult = await parseBriefDocument({
    briefId,
    source: sourceText,
    sourceSha256: fileSha256,
  });

  if (!parseResult.ok) {
    await svc
      .from("briefs")
      .update({
        status: "failed_parse",
        parse_failure_code: parseResult.code,
        parse_failure_detail: parseResult.detail,
        parser_warnings: parseResult.warnings,
        updated_at: now(),
      })
      .eq("id", briefId);

    return {
      ok: true,
      data: {
        brief_id: briefId,
        site_id: input.siteId,
        status: "failed_parse",
        parser_mode: null,
        review_url: briefReviewUrl(input.siteId, briefId),
        replay: false,
      },
      timestamp: now(),
    };
  }

  // Post-parse token cap check — reject briefs the runner can't fit in
  // its 60k input-token budget even if the file size is under 10 MB.
  if (approxTokenCount(sourceText) > BRIEF_MAX_CONTENT_TOKENS) {
    await svc
      .from("briefs")
      .update({
        status: "failed_parse",
        parse_failure_code: "BRIEF_TOO_LARGE",
        parse_failure_detail: `Content exceeds the ~${BRIEF_MAX_CONTENT_TOKENS}-token cap.`,
        parser_warnings: parseResult.warnings,
        updated_at: now(),
      })
      .eq("id", briefId);
    return errorEnvelope(
      "BRIEF_TOO_LARGE",
      "Brief content exceeds the token budget the runner can hold in context.",
      { details: { brief_id: briefId } },
    );
  }

  // 6. Insert brief_pages rows.
  const pageRows = parseResult.pages.map((p: BriefPageDraft) => ({
    brief_id: briefId,
    ordinal: p.ordinal,
    title: p.title.slice(0, 200),
    mode: p.mode,
    source_text: p.source_text,
    word_count: p.word_count,
    source_span_start: p.source_span_start,
    source_span_end: p.source_span_end,
    created_by: input.uploadedBy,
    updated_by: input.uploadedBy,
  }));

  if (pageRows.length > 0) {
    const pagesInsert = await svc.from("brief_pages").insert(pageRows);
    if (pagesInsert.error) {
      return errorEnvelope("INTERNAL_ERROR", "Failed to insert brief_pages.", {
        details: { supabase_error: pagesInsert.error },
      });
    }
  }

  // 7. Flip briefs.status → parsed + write parser metadata.
  // CAS on version_lock prevents a concurrent update from silently
  // winning — matches the pattern used by commitBrief and every other
  // version_lock-bearing UPDATE in the repo.
  const finalize = await svc
    .from("briefs")
    .update({
      status: "parsed",
      parser_mode: parseResult.parser_mode,
      parser_warnings: parseResult.warnings,
      version_lock: insert.data.version_lock + 1,
      updated_at: now(),
    })
    .eq("id", briefId)
    .eq("version_lock", insert.data.version_lock)
    .select("id")
    .maybeSingle();
  if (finalize.error) {
    return errorEnvelope("INTERNAL_ERROR", "Failed to finalize brief.", {
      details: { supabase_error: finalize.error },
    });
  }
  if (!finalize.data) {
    logger.error("briefs.parse.finalize_version_lock_mismatch", {
      brief_id: briefId,
      expected_version_lock: insert.data.version_lock,
    });
    return errorEnvelope(
      "INTERNAL_ERROR",
      "Brief was modified by a concurrent request during parse. Please retry.",
    );
  }

  return {
    ok: true,
    data: {
      brief_id: briefId,
      site_id: input.siteId,
      status: "parsed",
      parser_mode: parseResult.parser_mode,
      review_url: briefReviewUrl(input.siteId, briefId),
      replay: false,
    },
    timestamp: now(),
  };
}

// ---------------------------------------------------------------------------
// getBriefWithPages — server component read helper.
// ---------------------------------------------------------------------------

export async function getBriefWithPages(
  briefId: string,
): Promise<ApiResponse<{ brief: BriefRow; pages: BriefPageRow[] }>> {
  const svc = getServiceRoleClient();
  const briefRes = await svc
    .from("briefs")
    .select("*")
    .eq("id", briefId)
    .is("deleted_at", null)
    .maybeSingle();
  if (briefRes.error) {
    return errorEnvelope("INTERNAL_ERROR", "Failed to fetch brief.", {
      details: { supabase_error: briefRes.error },
    });
  }
  if (!briefRes.data) {
    return errorEnvelope("NOT_FOUND", `No brief with id ${briefId}.`);
  }

  const pagesRes = await svc
    .from("brief_pages")
    .select("*")
    .eq("brief_id", briefId)
    .is("deleted_at", null)
    .order("ordinal", { ascending: true });
  if (pagesRes.error) {
    return errorEnvelope("INTERNAL_ERROR", "Failed to fetch brief pages.", {
      details: { supabase_error: pagesRes.error },
    });
  }

  return {
    ok: true,
    data: {
      brief: briefRes.data as BriefRow,
      pages: (pagesRes.data ?? []) as BriefPageRow[],
    },
    timestamp: now(),
  };
}

// ---------------------------------------------------------------------------
// commitBrief — freeze the page list, unlock the runner.
// ---------------------------------------------------------------------------

export type CommitBriefInput = {
  briefId: string;
  expectedVersionLock: number;
  pageHash: string;
  committedBy: string | null;
  // M12-2 — optional overrides. `undefined` means "don't touch the
  // column" (preserves prior value); `null` explicitly clears. Empty
  // string is a valid distinct value but not treated differently from
  // null by the runner.
  brandVoice?: string | null;
  designDirection?: string | null;
  // M12-5 — operator-chosen model tier per brief. `undefined` preserves
  // the migration default (sonnet). DB CHECK validates the value against
  // the allowlist; the runner has an app-layer guard too.
  textModel?: string;
  visualModel?: string;
};

export type CommitBriefData = {
  brief_id: string;
  committed_at: string;
  committed_page_hash: string;
  replay: boolean;
};

export function computePageHash(
  pages: Array<Pick<BriefPageRow, "ordinal" | "title" | "mode" | "source_text">>,
): string {
  const normalised = [...pages]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((p) => ({
      ordinal: p.ordinal,
      title: p.title,
      mode: p.mode,
      source_sha256: sha256Hex(p.source_text),
    }));
  return sha256Hex(JSON.stringify(normalised));
}

export async function commitBrief(
  input: CommitBriefInput,
): Promise<ApiResponse<CommitBriefData>> {
  try {
    return await commitBriefImpl(input);
  } catch (err) {
    return errorEnvelope("INTERNAL_ERROR", `commitBrief threw: ${
      err instanceof Error ? err.message : String(err)
    }`);
  }
}

async function commitBriefImpl(
  input: CommitBriefInput,
): Promise<ApiResponse<CommitBriefData>> {
  const svc = getServiceRoleClient();

  // 1. Fetch brief + its pages.
  const briefRes = await svc
    .from("briefs")
    .select("*")
    .eq("id", input.briefId)
    .is("deleted_at", null)
    .maybeSingle();
  if (briefRes.error) {
    return errorEnvelope("INTERNAL_ERROR", "Failed to fetch brief.", {
      details: { supabase_error: briefRes.error },
    });
  }
  if (!briefRes.data) {
    return errorEnvelope("NOT_FOUND", `No brief with id ${input.briefId}.`);
  }
  const brief = briefRes.data as BriefRow;

  // Replay: already committed + same page_hash → success envelope.
  if (brief.status === "committed") {
    if (brief.committed_page_hash === input.pageHash) {
      return {
        ok: true,
        data: {
          brief_id: brief.id,
          committed_at: brief.committed_at ?? now(),
          committed_page_hash: brief.committed_page_hash ?? input.pageHash,
          replay: true,
        },
        timestamp: now(),
      };
    }
    return errorEnvelope(
      "ALREADY_EXISTS",
      "This brief is already committed under a different page list.",
      { details: { brief_id: brief.id } },
    );
  }

  if (brief.status !== "parsed") {
    return errorEnvelope(
      "VALIDATION_FAILED",
      `Brief is in status '${brief.status}', not 'parsed'. Cannot commit.`,
    );
  }

  if (brief.version_lock !== input.expectedVersionLock) {
    return errorEnvelope(
      "VERSION_CONFLICT",
      "The brief was edited while you were reviewing. Refresh and commit again.",
      { details: { expected: input.expectedVersionLock, actual: brief.version_lock } },
    );
  }

  const pagesRes = await svc
    .from("brief_pages")
    .select("ordinal, title, mode, source_text")
    .eq("brief_id", brief.id)
    .is("deleted_at", null)
    .order("ordinal", { ascending: true });
  if (pagesRes.error) {
    return errorEnvelope("INTERNAL_ERROR", "Failed to fetch brief pages.", {
      details: { supabase_error: pagesRes.error },
    });
  }
  const currentPages = (pagesRes.data ?? []) as Array<
    Pick<BriefPageRow, "ordinal" | "title" | "mode" | "source_text">
  >;

  // Recompute the hash from the DB and compare.
  const serverHash = computePageHash(currentPages);
  if (serverHash !== input.pageHash) {
    return errorEnvelope(
      "VERSION_CONFLICT",
      "The page list on the server differs from the list you committed. Refresh and try again.",
      { details: { server_hash: serverHash } },
    );
  }

  // 2. UPDATE briefs under version_lock.
  //
  // brand_voice / design_direction are only included in the UPDATE SET
  // list when the caller explicitly provided them (`undefined` means
  // "don't touch"). This keeps commit idempotent across code paths that
  // don't know about the M12-2 fields — e.g. a server-side retry that
  // reconstructs input without the user-supplied form values.
  const committedAt = now();
  const updatePatch: Record<string, unknown> = {
    status: "committed",
    committed_at: committedAt,
    committed_by: input.committedBy,
    committed_page_hash: serverHash,
    version_lock: brief.version_lock + 1,
    updated_at: committedAt,
    updated_by: input.committedBy,
  };
  if (input.brandVoice !== undefined) {
    updatePatch.brand_voice = input.brandVoice;
  }
  if (input.designDirection !== undefined) {
    updatePatch.design_direction = input.designDirection;
  }
  if (input.textModel !== undefined) {
    updatePatch.text_model = input.textModel;
  }
  if (input.visualModel !== undefined) {
    updatePatch.visual_model = input.visualModel;
  }

  const update = await svc
    .from("briefs")
    .update(updatePatch)
    .eq("id", brief.id)
    .eq("version_lock", brief.version_lock)
    .select("id")
    .maybeSingle();

  if (update.error) {
    return errorEnvelope("INTERNAL_ERROR", "Failed to commit brief.", {
      details: { supabase_error: update.error },
    });
  }
  if (!update.data) {
    return errorEnvelope(
      "VERSION_CONFLICT",
      "The brief was updated by another session. Refresh and commit again.",
    );
  }

  return {
    ok: true,
    data: {
      brief_id: brief.id,
      committed_at: committedAt,
      committed_page_hash: serverHash,
      replay: false,
    },
    timestamp: now(),
  };
}

// ---------------------------------------------------------------------------
// listSiteBriefs — for the site detail page's "Briefs" section.
// ---------------------------------------------------------------------------

export async function listSiteBriefs(
  siteId: string,
): Promise<ApiResponse<{ briefs: Array<Pick<BriefRow, "id" | "title" | "status" | "parser_mode" | "created_at" | "updated_at" | "committed_at">> }>> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("briefs")
    .select("id, title, status, parser_mode, created_at, updated_at, committed_at")
    .eq("site_id", siteId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) {
    return errorEnvelope("INTERNAL_ERROR", "Failed to list briefs.", {
      details: { supabase_error: error },
    });
  }
  return {
    ok: true,
    data: { briefs: (data ?? []) as Array<Pick<BriefRow, "id" | "title" | "status" | "parser_mode" | "created_at" | "updated_at" | "committed_at">> },
    timestamp: now(),
  };
}

// ---------------------------------------------------------------------------
// M12-4 — startBriefRun + pre-flight cost estimate.
//
// Risk #15 (operator-blind overspend): before an operator kicks off a
// brief run, surface the estimated cost against the tenant's remaining
// monthly budget. If the estimate exceeds 50% of remaining budget,
// return CONFIRMATION_REQUIRED — the UI (M12-5) prompts the operator
// and re-submits with confirmed: true to proceed.
//
// This is a soft gate. The hard gate is the existing reserveWithCeiling
// path in lib/tenant-budgets.ts which halts the runner mid-flight if
// actuals exceed the monthly cap. This function only blocks pre-flight
// — once the run starts, a runaway cost is caught by the per-page
// ceiling + reserveWithCeiling, not this helper.
// ---------------------------------------------------------------------------

export type StartBriefRunInput = {
  briefId: string;
  startedBy: string | null;
  confirmed?: boolean;
};

export type StartBriefRunData = {
  brief_run_id: string;
  estimate_cents: number;
  remaining_budget_cents: number;
  // Soft cap — if estimate exceeds this fraction of remaining_budget_cents,
  // we require the operator to confirm. 0.5 by design (see Risk #15).
};

const BUDGET_CONFIRMATION_THRESHOLD = 0.5;

export async function estimateBriefRunCost(
  briefId: string,
): Promise<
  | { ok: true; estimate_cents: number; page_count: number }
  | { ok: false; code: "NOT_FOUND" | "INTERNAL_ERROR"; message: string }
> {
  const svc = getServiceRoleClient();
  const briefRes = await svc
    .from("briefs")
    .select("id, text_model, visual_model, status")
    .eq("id", briefId)
    .is("deleted_at", null)
    .maybeSingle();
  if (briefRes.error) {
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: briefRes.error.message,
    };
  }
  if (!briefRes.data) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: `No brief with id ${briefId}.`,
    };
  }
  const brief = briefRes.data as {
    id: string;
    text_model: string;
    visual_model: string;
    status: BriefRow["status"];
  };
  const pagesRes = await svc
    .from("brief_pages")
    .select("id", { count: "exact", head: true })
    .eq("brief_id", briefId)
    .is("deleted_at", null);
  const pageCount = pagesRes.count ?? 0;
  const estimate = estimateBriefRunCostCents({
    text_model: brief.text_model,
    visual_model: brief.visual_model,
    page_count: pageCount,
    anchor_present: pageCount > 0,
  });
  return { ok: true, estimate_cents: estimate, page_count: pageCount };
}

export async function startBriefRun(
  input: StartBriefRunInput,
): Promise<ApiResponse<StartBriefRunData>> {
  const svc = getServiceRoleClient();

  const briefRes = await svc
    .from("briefs")
    .select("id, site_id, status")
    .eq("id", input.briefId)
    .is("deleted_at", null)
    .maybeSingle();
  if (briefRes.error) {
    return errorEnvelope("INTERNAL_ERROR", "Failed to fetch brief.", {
      details: { supabase_error: briefRes.error },
    });
  }
  if (!briefRes.data) {
    return errorEnvelope("NOT_FOUND", `No brief ${input.briefId}.`);
  }
  const brief = briefRes.data as { id: string; site_id: string; status: BriefRow["status"] };
  if (brief.status !== "committed") {
    return errorEnvelope(
      "VALIDATION_FAILED",
      `Brief is in status '${brief.status}', not 'committed'. Commit the brief before starting a run.`,
    );
  }

  // Estimate + remaining budget.
  const estimate = await estimateBriefRunCost(input.briefId);
  if (!estimate.ok) {
    return errorEnvelope(estimate.code, estimate.message);
  }
  const budget = await svc
    .from("tenant_cost_budgets")
    .select("monthly_cap_cents, monthly_usage_cents")
    .eq("site_id", brief.site_id)
    .maybeSingle();
  if (budget.error) {
    return errorEnvelope("INTERNAL_ERROR", "Failed to fetch tenant budget.", {
      details: { supabase_error: budget.error },
    });
  }
  const cap = Number(budget.data?.monthly_cap_cents ?? 0);
  const usage = Number(budget.data?.monthly_usage_cents ?? 0);
  const remainingBudgetCents = Math.max(0, cap - usage);

  const requiresConfirmation =
    !input.confirmed &&
    remainingBudgetCents > 0 &&
    estimate.estimate_cents > remainingBudgetCents * BUDGET_CONFIRMATION_THRESHOLD;

  if (requiresConfirmation) {
    return errorEnvelope(
      "CONFIRMATION_REQUIRED",
      `This run's estimated cost (${estimate.estimate_cents} cents) exceeds 50% of the remaining tenant budget (${remainingBudgetCents} cents). Re-submit with confirmed: true to proceed.`,
      {
        details: {
          estimate_cents: estimate.estimate_cents,
          remaining_budget_cents: remainingBudgetCents,
          threshold: BUDGET_CONFIRMATION_THRESHOLD,
          page_count: estimate.page_count,
        },
      },
    );
  }

  // Insert the brief_run row. The DB partial UNIQUE index
  // brief_runs_one_active_per_brief guards against two active runs on
  // the same brief.
  const runInsert = await svc
    .from("brief_runs")
    .insert({
      brief_id: brief.id,
      status: "queued",
      created_by: input.startedBy,
      updated_by: input.startedBy,
    })
    .select("id")
    .single();
  if (runInsert.error || !runInsert.data) {
    if (runInsert.error?.code === "23505") {
      return errorEnvelope(
        "BRIEF_RUN_ALREADY_ACTIVE",
        "There is already an active brief_run for this brief. Cancel it before starting a new one.",
      );
    }
    return errorEnvelope("INTERNAL_ERROR", "Failed to insert brief_run.", {
      details: { supabase_error: runInsert.error ?? null },
    });
  }
  return {
    ok: true,
    data: {
      brief_run_id: runInsert.data.id as string,
      estimate_cents: estimate.estimate_cents,
      remaining_budget_cents: remainingBudgetCents,
    },
    timestamp: now(),
  };
}
