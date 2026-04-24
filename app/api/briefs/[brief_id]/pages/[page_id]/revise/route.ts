import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  parseBodyWith,
  readJsonBody,
  validateUuidParam,
} from "@/lib/http";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// M12-5 — POST /api/briefs/[brief_id]/pages/[page_id]/revise
//
// Operator sees the awaiting_review preview, decides the page needs
// another pass with a specific note, and submits. This route:
//
//   1. Appends the note to brief_pages.operator_notes (preserves
//      prior notes across multiple revise cycles).
//   2. Resets the page to page_status='pending', current_pass_kind=null,
//      current_pass_number=0, draft_html=null, quality_flag=null. The
//      runner re-enters from the top on its next tick. critique_log is
//      preserved — the note carries context, not the prior drafts.
//   3. Re-queues the brief_run at this page's ordinal (mirrors
//      approveBriefPage's re-queue shape).
//
// The runner's PageContext carries operator_notes into the draft /
// critique / revise prompts (wired in this PR's brief-runner change).
//
// Body:
//   {
//     expected_version_lock: int,      // CAS against brief_pages
//     note: string (1..2000 chars)     // the operator's feedback
//   }
//
// Error cases:
//   VALIDATION_FAILED (400) — malformed body / non-UUID params / empty note
//   NOT_FOUND (404)         — unknown page / brief_id mismatch
//   INVALID_STATE (409)     — page not in awaiting_review (can't revise
//                             a page that's still generating or already
//                             approved; cancel first)
//   VERSION_CONFLICT (409)  — expected_version_lock stale
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ReviseBodySchema = z.object({
  expected_version_lock: z.number().int().nonnegative(),
  note: z.string().min(1).max(2000),
});

function envelope(
  code: string,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: false },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

function appendNote(existing: string | null, next: string, at: string): string {
  const stamped = `[${at}] ${next.trim()}`;
  if (!existing || existing.trim() === "") return stamped;
  return `${existing.trim()}\n\n${stamped}`;
}

export async function POST(
  req: Request,
  { params }: { params: { brief_id: string; page_id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["admin", "operator"] });
  if (gate.kind === "deny") return gate.response;

  const briefIdCheck = validateUuidParam(params.brief_id, "brief_id");
  if (!briefIdCheck.ok) return briefIdCheck.response;
  const pageIdCheck = validateUuidParam(params.page_id, "page_id");
  if (!pageIdCheck.ok) return pageIdCheck.response;

  const body = await readJsonBody(req);
  const parsed = parseBodyWith(ReviseBodySchema, body);
  if (!parsed.ok) return parsed.response;

  const svc = getServiceRoleClient();

  const pageLookup = await svc
    .from("brief_pages")
    .select(
      "id, brief_id, ordinal, page_status, operator_notes, version_lock",
    )
    .eq("id", pageIdCheck.value)
    .is("deleted_at", null)
    .maybeSingle();
  if (pageLookup.error) {
    logger.error("briefs.revise.page_lookup_failed", {
      page_id: pageIdCheck.value,
      error: pageLookup.error,
    });
    return envelope("INTERNAL_ERROR", "Failed to look up brief_page.", 500);
  }
  if (!pageLookup.data) {
    return envelope(
      "NOT_FOUND",
      `No brief_page ${pageIdCheck.value}.`,
      404,
    );
  }
  const page = pageLookup.data as {
    id: string;
    brief_id: string;
    ordinal: number;
    page_status: string;
    operator_notes: string | null;
    version_lock: number;
  };

  if (page.brief_id !== briefIdCheck.value) {
    return envelope(
      "NOT_FOUND",
      `Brief_page ${pageIdCheck.value} does not belong to brief ${briefIdCheck.value}.`,
      404,
    );
  }
  if (page.page_status !== "awaiting_review") {
    return envelope(
      "INVALID_STATE",
      `Page is in status '${page.page_status}', not 'awaiting_review'. Cancel the run to edit a page that's still generating; approved pages are read-only.`,
      409,
    );
  }

  const nowIso = new Date().toISOString();
  const nextNotes = appendNote(page.operator_notes, parsed.data.note, nowIso);

  // CAS reset under version_lock. Clears draft state so the runner
  // re-enters from the top; critique_log stays so the operator still
  // sees history; quality_flag is cleared so the fresh run can set its
  // own.
  const upd = await svc
    .from("brief_pages")
    .update({
      page_status: "pending",
      current_pass_kind: null,
      current_pass_number: 0,
      draft_html: null,
      quality_flag: null,
      operator_notes: nextNotes,
      updated_at: nowIso,
      updated_by: gate.user?.id ?? null,
      version_lock: parsed.data.expected_version_lock + 1,
    })
    .eq("id", page.id)
    .eq("version_lock", parsed.data.expected_version_lock)
    .select("id")
    .maybeSingle();
  if (upd.error) {
    logger.error("briefs.revise.update_failed", {
      page_id: page.id,
      error: upd.error,
    });
    return envelope("INTERNAL_ERROR", "Failed to re-queue page.", 500);
  }
  if (!upd.data) {
    return envelope(
      "VERSION_CONFLICT",
      "Page was edited while you were reviewing. Refresh and retry.",
      409,
    );
  }

  // Re-queue the run at this page's ordinal so the next tick picks it up.
  // Similar shape to approveBriefPage's re-queue — idempotent if the run
  // is already queued.
  const runRes = await svc
    .from("brief_runs")
    .select("id, status, version_lock")
    .eq("brief_id", page.brief_id)
    .in("status", ["paused", "running", "queued"])
    .maybeSingle();
  if (runRes.data) {
    const runSnap = runRes.data as {
      id: string;
      status: string;
      version_lock: number;
    };
    await svc
      .from("brief_runs")
      .update({
        status: "queued",
        current_ordinal: page.ordinal,
        updated_at: nowIso,
        version_lock: runSnap.version_lock + 1,
      })
      .eq("id", runSnap.id)
      .eq("version_lock", runSnap.version_lock);
  }

  // Bust the run surface so the operator sees the pending transition.
  const briefLookup = await svc
    .from("briefs")
    .select("site_id")
    .eq("id", briefIdCheck.value)
    .maybeSingle();
  const siteId = (briefLookup.data?.site_id as string | undefined) ?? null;
  if (siteId) {
    revalidatePath(
      `/admin/sites/${siteId}/briefs/${briefIdCheck.value}/run`,
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: {
        page_id: page.id,
        page_status: "pending",
      },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
