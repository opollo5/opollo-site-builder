import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { approveBriefPage } from "@/lib/brief-runner";
import {
  parseBodyWith,
  readJsonBody,
  validateUuidParam,
  validationError,
} from "@/lib/http";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// M12-3 — POST /api/briefs/[brief_id]/pages/[page_id]/approve.
//
// Operator approves a brief_page whose runner-advanced it to
// awaiting_review. Approval:
//
//   1. Promotes draft_html → generated_html (schema-enforced coherent
//      with page_status='approved').
//   2. Writes approved_at + approved_by + the caller's updated_by.
//   3. Appends a short marker to brief_runs.content_summary so the next
//      page's context includes "Page N approved."
//   4. Re-queues the brief_run at current_ordinal + 1 so the next tick
//      picks up page N+1.
//
// Every step is wrapped in version_lock CAS; a mid-review concurrent
// edit → VERSION_CONFLICT (409). Called with the wrong page state →
// INVALID_STATE (409). Called without an existing page or with a
// brief_id that doesn't match the URL → NOT_FOUND (404).
//
// Approval is user-triggered (not worker-triggered) so it runs outside
// the brief runner's lease. The runner and the approve route never
// write the same brief_pages row at the same time because the runner's
// state machine only writes while page_status IN ('pending','generating')
// and approve only runs when page_status = 'awaiting_review'.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ApproveBodySchema = z.object({
  expected_version_lock: z.number().int().nonnegative(),
  summary_addendum: z.string().max(2000).optional(),
});

function errorEnvelope(
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
  const parsed = parseBodyWith(ApproveBodySchema, body);
  if (!parsed.ok) return parsed.response;

  // Defence-in-depth: reject page_id/brief_id mismatch at the edge
  // rather than deep in the helper. A mismatch would still be caught
  // by the lookup below (page.brief_id check in approveBriefPage is
  // implicit via the lookup), but returning 404 here keeps the admin
  // surface honest when an operator crafts a URL by hand.
  const svc = getServiceRoleClient();
  const pageLookup = await svc
    .from("brief_pages")
    .select("id, brief_id")
    .eq("id", pageIdCheck.value)
    .maybeSingle();
  if (pageLookup.error) {
    logger.error("briefs.pages.approve.lookup_failed", {
      brief_id: briefIdCheck.value,
      page_id: pageIdCheck.value,
      error: pageLookup.error,
    });
    return errorEnvelope(
      "INTERNAL_ERROR",
      "Failed to look up brief_page.",
      500,
    );
  }
  if (!pageLookup.data) {
    return errorEnvelope(
      "NOT_FOUND",
      `No brief_page ${pageIdCheck.value}.`,
      404,
    );
  }
  if ((pageLookup.data.brief_id as string) !== briefIdCheck.value) {
    // Path mismatch. 404 (the page doesn't exist under this brief)
    // rather than 400 — prevents enumeration and matches REST semantics.
    return errorEnvelope(
      "NOT_FOUND",
      `Brief_page ${pageIdCheck.value} does not belong to brief ${briefIdCheck.value}.`,
      404,
    );
  }

  const result = await approveBriefPage({
    pageId: pageIdCheck.value,
    expectedVersionLock: parsed.data.expected_version_lock,
    approvedBy: gate.user?.id ?? null,
    summaryAddendum: parsed.data.summary_addendum,
  });

  if (!result.ok) {
    logger.warn("briefs.pages.approve.failed", {
      brief_id: briefIdCheck.value,
      page_id: pageIdCheck.value,
      code: result.code,
    });
    switch (result.code) {
      case "NOT_FOUND":
        return errorEnvelope("NOT_FOUND", result.message, 404);
      case "INVALID_STATE":
        // 409 conflict — resource is not in a state that allows this
        // transition. Operator should refresh + retry.
        return errorEnvelope("INVALID_STATE", result.message, 409);
      case "VERSION_CONFLICT":
        return errorEnvelope("VERSION_CONFLICT", result.message, 409);
      case "INTERNAL_ERROR":
        return errorEnvelope("INTERNAL_ERROR", result.message, 500);
    }
  }

  // Bust the review page + site detail caches so the approve surfaces
  // the new state on next render.
  const siteLookup = await svc
    .from("briefs")
    .select("site_id")
    .eq("id", briefIdCheck.value)
    .maybeSingle();
  const siteId = (siteLookup.data?.site_id as string | undefined) ?? null;
  if (siteId) {
    revalidatePath(
      `/admin/sites/${siteId}/briefs/${briefIdCheck.value}/review`,
    );
    revalidatePath(`/admin/sites/${siteId}`);
  }

  return NextResponse.json(
    {
      ok: true,
      data: {
        page_id: pageIdCheck.value,
        page_status: result.pageStatus,
        run_status: result.runStatus,
      },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}

// Defence: reject unexpected params shapes early so stray GETs or
// mis-routed requests don't silently 404-via-Next.
export function GET(): NextResponse {
  return validationError("Use POST to approve a brief page.");
}
