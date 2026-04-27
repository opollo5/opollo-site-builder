import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { logAppearanceEvent } from "@/lib/appearance-events";
import { validateUuidParam } from "@/lib/http";
import {
  buildPaletteSyncContext,
  paletteDryRunFromContext,
  stampFirstDetection,
} from "@/lib/kadence-palette-sync";
import { logger } from "@/lib/logger";
import { preflightSitePublish } from "@/lib/site-preflight";

// ---------------------------------------------------------------------------
// M13-5c — POST /api/sites/[id]/appearance/preflight
//
// Runs the capability probe + Kadence detection, stamps
// sites.kadence_installed_at under CAS on first-confirmed-detection,
// writes a preflight_run audit event, and returns:
//
//   { preflight, install, proposal, diff, already_synced }
//
// Read-only from the WP side — three GETs (site-preflight's
// /users/me + getKadenceInstallState's /themes reads + palette read).
// The only writes are Opollo-side: the CAS timestamp stamp + audit.
//
// Body: empty (the operator click is the whole signal).
//
// Errors:
//   404 NOT_FOUND — unknown site id
//   403 PREFLIGHT_BLOCKED — WP caps missing / REST unreachable (site-preflight failure)
//   409 KADENCE_NOT_ACTIVE — preflight passes but Kadence isn't the active theme (manual install needed)
//   409 VERSION_CONFLICT — stamping CAS lost against a concurrent sites.update
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function envelope(
  code: string,
  message: string,
  status: number,
  details?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: false, details },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["admin", "operator"] });
  if (gate.kind === "deny") return gate.response;

  const idCheck = validateUuidParam(params.id, "id");
  if (!idCheck.ok) return idCheck.response;

  // Step 1 — capability preflight (cap check + REST reachability).
  const preflightRes = await preflightSitePublish(idCheck.value);
  if (!preflightRes.ok) {
    await logAppearanceEvent({
      site_id: idCheck.value,
      event: "preflight_run",
      details: {
        outcome: "blocked",
        blocker_code: preflightRes.blocker.code,
      },
      created_by: gate.user?.id ?? null,
    });
    return envelope(
      "PREFLIGHT_BLOCKED",
      preflightRes.blocker.detail,
      403,
      { blocker: preflightRes.blocker },
    );
  }

  // Step 2 — build palette-sync context (detects Kadence + reads
  // current palette + builds proposal).
  const ctxRes = await buildPaletteSyncContext(idCheck.value);
  if (!ctxRes.ok) {
    await logAppearanceEvent({
      site_id: idCheck.value,
      event: "preflight_run",
      details: {
        outcome: "context_build_failed",
        code: ctxRes.code,
      },
      created_by: gate.user?.id ?? null,
    });
    if (ctxRes.code === "KADENCE_NOT_ACTIVE") {
      return envelope("KADENCE_NOT_ACTIVE", ctxRes.message, 409, ctxRes.details);
    }
    if (ctxRes.code === "SITE_NOT_FOUND") {
      return envelope("NOT_FOUND", ctxRes.message, 404);
    }
    if (ctxRes.code === "SITE_CONFIG_MISSING") {
      return envelope("SITE_CONFIG_MISSING", ctxRes.message, 409);
    }
    if (ctxRes.code === "DS_NOT_FOUND") {
      return envelope("DS_NOT_FOUND", ctxRes.message, 409);
    }
    if (ctxRes.code === "WP_AUTH_FAILED") {
      return envelope("AUTH_FAILED", ctxRes.message, 401, ctxRes.details);
    }
    if (ctxRes.code === "WP_REST_UNREACHABLE") {
      return envelope("WP_API_ERROR", ctxRes.message, 502, ctxRes.details);
    }
    logger.error("appearance.preflight.context_internal_error", {
      site_id: idCheck.value,
      ctx_code: ctxRes.code,
      ctx_message: ctxRes.message,
    });
    return envelope("INTERNAL_ERROR", ctxRes.message, 500);
  }

  // Step 3 — first-detection stamp. Idempotent: if already stamped,
  // returns stamped=false without touching the row.
  const stamp = await stampFirstDetection({
    site_id: idCheck.value,
    expected_version_lock: ctxRes.ctx.site_version_lock,
    created_by: gate.user?.id ?? null,
  });
  if (!stamp.ok) {
    if (stamp.code === "VERSION_CONFLICT") {
      return envelope("VERSION_CONFLICT", stamp.message, 409);
    }
    logger.error("appearance.preflight.stamp_errored", {
      site_id: idCheck.value,
      reason: stamp.message,
    });
    // Non-fatal — we can still return the context. Audit it.
    await logAppearanceEvent({
      site_id: idCheck.value,
      event: "preflight_run",
      details: {
        outcome: "stamp_errored",
        reason: stamp.message,
      },
      created_by: gate.user?.id ?? null,
    });
  }

  // Step 4 — success audit. Records whether a new stamp landed so the
  // panel's event-log surface can highlight first-detection moments.
  await logAppearanceEvent({
    site_id: idCheck.value,
    event: "preflight_run",
    details: {
      outcome: "ready",
      stamped_first_detection: stamp.ok ? stamp.stamped : false,
      already_synced: !ctxRes.ctx.diff.any_changes,
      proposal_source: ctxRes.ctx.proposal.source,
      kadence_version: ctxRes.ctx.install.kadence_version,
    },
    created_by: gate.user?.id ?? null,
  });

  revalidatePath(`/admin/sites/${idCheck.value}/appearance`);
  revalidatePath(`/admin/sites/${idCheck.value}`);

  const preview = paletteDryRunFromContext(ctxRes.ctx);
  return NextResponse.json(
    {
      ok: true,
      data: {
        preflight: { capabilities: preflightRes.capabilities },
        install: preview.install,
        current_palette: preview.current_palette,
        current_palette_sha: preview.current_palette_sha,
        proposal: preview.proposal,
        diff: preview.diff,
        already_synced: preview.already_synced,
        site_version_lock:
          stamp.ok ? stamp.new_version_lock : ctxRes.ctx.site_version_lock,
      },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
