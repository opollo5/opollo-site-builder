import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { validateUuidParam } from "@/lib/http";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// M12-5 — POST /api/briefs/[brief_id]/cancel
//
// Halts the active brief_run for this brief. Leaves generated brief_pages
// in place (per parent plan: "cancel halts the runner and leaves
// generated pages in place — no destructive cleanup"). Operator can still
// approve any page already at awaiting_review after cancel, and can
// start a fresh run once the current one is cancelled (the partial
// UNIQUE index brief_runs_one_active_per_brief only guards the
// non-terminal slot).
//
// Idempotent by design: a cancel on a brief with no active run, or on
// a run already cancelled, returns 200 + { already_cancelled: true }.
// Two operator tabs clicking cancel simultaneously both see success.
//
// Body: empty (cancellation is a scoped verb; no cancel-with-reason
// flow today — operator notes live on brief_pages via /revise).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function POST(
  _req: Request,
  { params }: { params: { brief_id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["admin", "operator"] });
  if (gate.kind === "deny") return gate.response;

  const idCheck = validateUuidParam(params.brief_id, "brief_id");
  if (!idCheck.ok) return idCheck.response;

  const svc = getServiceRoleClient();

  const briefLookup = await svc
    .from("briefs")
    .select("id, site_id")
    .eq("id", idCheck.value)
    .is("deleted_at", null)
    .maybeSingle();
  if (briefLookup.error) {
    return envelope("INTERNAL_ERROR", "Failed to look up brief.", 500);
  }
  if (!briefLookup.data) {
    return envelope("NOT_FOUND", `No brief ${idCheck.value}.`, 404);
  }
  const siteId = briefLookup.data.site_id as string;

  const runLookup = await svc
    .from("brief_runs")
    .select("id, status, version_lock")
    .eq("brief_id", idCheck.value)
    .in("status", ["queued", "running", "paused"])
    .maybeSingle();
  if (runLookup.error) {
    logger.error("briefs.cancel.run_lookup_failed", {
      brief_id: idCheck.value,
      error: runLookup.error,
    });
    return envelope("INTERNAL_ERROR", "Failed to look up active run.", 500);
  }
  if (!runLookup.data) {
    // Idempotent: no active run is a successful no-op.
    return NextResponse.json(
      {
        ok: true,
        data: { already_cancelled: true },
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  }

  const runSnap = runLookup.data as {
    id: string;
    status: string;
    version_lock: number;
  };

  const nowIso = new Date().toISOString();
  const update = await svc
    .from("brief_runs")
    .update({
      status: "cancelled",
      cancel_requested_at: nowIso,
      finished_at: nowIso,
      lease_expires_at: null,
      worker_id: null,
      updated_at: nowIso,
      updated_by: gate.user?.id ?? null,
      version_lock: runSnap.version_lock + 1,
    })
    .eq("id", runSnap.id)
    .eq("version_lock", runSnap.version_lock)
    .select("id, status")
    .maybeSingle();

  if (update.error) {
    logger.error("briefs.cancel.update_failed", {
      brief_run_id: runSnap.id,
      error: update.error,
    });
    return envelope("INTERNAL_ERROR", "Failed to cancel run.", 500);
  }
  if (!update.data) {
    // CAS miss — another tab beat us to cancel. Re-read and treat as
    // idempotent success.
    return NextResponse.json(
      {
        ok: true,
        data: { already_cancelled: true },
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  }

  revalidatePath(`/admin/sites/${siteId}/briefs/${idCheck.value}/run`);
  revalidatePath(`/admin/sites/${siteId}/briefs/${idCheck.value}/review`);
  revalidatePath(`/admin/sites/${siteId}`);

  return NextResponse.json(
    {
      ok: true,
      data: {
        brief_run_id: runSnap.id,
        status: update.data.status,
        already_cancelled: false,
      },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
