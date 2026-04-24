import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { type BriefPageRow, type BriefRow } from "@/lib/briefs";
import {
  parseBodyWith,
  readJsonBody,
  respond,
  validateUuidParam,
} from "@/lib/http";
import type { ApiResponse } from "@/lib/tool-schemas";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// M12-6 — PATCH /api/briefs/[brief_id]/pages
//
// Saves draft edits to brief_pages under optimistic concurrency (brief's
// version_lock). Enables the "Save draft" button in BriefReviewClient so
// edits persist to DB before the commit flow.
//
// Body:
//   {
//     expected_version_lock: int,
//     pages: [
//       {
//         id: string (page uuid),
//         title?: string,
//         mode?: "full_text" | "short_brief",
//         source_text?: string,
//         operator_notes?: string | null,
//       }
//     ]
//   }
//
// Returns updated pages on success.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function now(): string {
  return new Date().toISOString();
}

function errorResponse<T = never>(
  code: string,
  message: string,
): ApiResponse<T> {
  return {
    ok: false,
    error: {
      code: code as any,
      message,
      retryable: false,
      suggested_action: "",
    },
    timestamp: now(),
  };
}

function successResponse<T>(data: T): ApiResponse<T> {
  return {
    ok: true,
    data,
    timestamp: now(),
  };
}

const PageUpdateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).optional(),
  mode: z.enum(["full_text", "short_brief"]).optional(),
  source_text: z.string().optional(),
  operator_notes: z.string().nullable().optional(),
});

const PatchBodySchema = z.object({
  expected_version_lock: z.number().int().nonnegative(),
  pages: z.array(PageUpdateSchema),
});

export async function PATCH(
  req: Request,
  { params }: { params: { brief_id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["admin", "operator"] });
  if (gate.kind === "deny") return gate.response;

  const idCheck = validateUuidParam(params.brief_id, "brief_id");
  if (!idCheck.ok) return idCheck.response;

  const body = await readJsonBody(req);
  const parsed = parseBodyWith(PatchBodySchema, body);
  if (!parsed.ok) return parsed.response;

  const svc = getServiceRoleClient();

  // 1. Fetch brief to check version_lock and existence.
  const briefRes = await svc
    .from("briefs")
    .select("id, version_lock")
    .eq("id", idCheck.value)
    .is("deleted_at", null)
    .maybeSingle();

  if (briefRes.error) {
    logger.error("briefs.pages.patch.fetch_failed", {
      brief_id: idCheck.value,
      error: briefRes.error,
    });
    return respond(errorResponse("INTERNAL_ERROR", "Failed to fetch brief."));
  }

  if (!briefRes.data) {
    return respond(errorResponse("NOT_FOUND", `No brief with id ${idCheck.value}.`));
  }

  // 2. Check version_lock.
  if (briefRes.data.version_lock !== parsed.data.expected_version_lock) {
    return respond(
      errorResponse("VERSION_CONFLICT", "Brief was modified by another user. Refresh and try again."),
    );
  }

  // 3. Update each page. We update the brief's updated_at and bump
  // version_lock as part of this batch to maintain optimistic concurrency.
  const updates = parsed.data.pages.map((p) => {
    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (p.title !== undefined) updatePayload.title = p.title;
    if (p.mode !== undefined) updatePayload.mode = p.mode;
    if (p.source_text !== undefined) {
      updatePayload.source_text = p.source_text;
      // Recompute word count from updated source_text.
      updatePayload.word_count = p.source_text.split(/\s+/).filter(Boolean).length;
    }
    if (p.operator_notes !== undefined) updatePayload.operator_notes = p.operator_notes;

    return svc
      .from("brief_pages")
      .update(updatePayload)
      .eq("id", p.id)
      .eq("brief_id", idCheck.value);
  });

  const updateResults = await Promise.all(updates);
  for (const result of updateResults) {
    if (result.error) {
      logger.error("briefs.pages.patch.update_failed", {
        brief_id: idCheck.value,
        error: result.error,
      });
      return respond(errorResponse("INTERNAL_ERROR", "Failed to update page."));
    }
  }

  // 4. Update brief's updated_at and bump version_lock.
  const bumped = await svc
    .from("briefs")
    .update({
      updated_at: new Date().toISOString(),
      version_lock: briefRes.data.version_lock + 1,
    })
    .eq("id", idCheck.value)
    .select("*")
    .single();

  if (bumped.error) {
    logger.error("briefs.pages.patch.bump_version_lock_failed", {
      brief_id: idCheck.value,
      error: bumped.error,
    });
    return respond(errorResponse("INTERNAL_ERROR", "Failed to save draft."));
  }

  // 5. Fetch updated pages to return.
  const pagesRes = await svc
    .from("brief_pages")
    .select("*")
    .eq("brief_id", idCheck.value)
    .is("deleted_at", null)
    .order("ordinal");

  if (pagesRes.error) {
    logger.error("briefs.pages.patch.fetch_pages_failed", {
      brief_id: idCheck.value,
      error: pagesRes.error,
    });
    return respond(errorResponse("INTERNAL_ERROR", "Failed to fetch updated pages."));
  }

  return respond(
    successResponse({
      brief: bumped.data as BriefRow,
      pages: pagesRes.data as BriefPageRow[],
    }),
  );
}
