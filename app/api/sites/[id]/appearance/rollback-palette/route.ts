import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  parseBodyWith,
  readJsonBody,
  validateUuidParam,
} from "@/lib/http";
import {
  buildPaletteSyncContext,
  rollbackPalette,
} from "@/lib/kadence-palette-sync";
import { preflightSitePublish } from "@/lib/site-preflight";

// ---------------------------------------------------------------------------
// M13-5c — POST /api/sites/[id]/appearance/rollback-palette
//
// Reverts the last confirmed palette sync. Reads the most recent
// globals_completed event, re-posts its previous_palette snapshot,
// and writes rollback_completed/rollback_failed audit.
//
// Body: { expected_site_version_lock: int }
//
// Idempotency: if current WP palette already matches the snapshot,
// returns ALREADY_ROLLED_BACK without a WP write.
//
// Edge cases:
//   - NO_PRIOR_SNAPSHOT (409) — site has never had a confirmed sync,
//     nothing to roll back to
//   - SNAPSHOT_MALFORMED (500) — the saved snapshot is missing /
//     corrupt (shouldn't happen in practice; surfaces as operator-
//     visible error so we notice)
//   - PREFLIGHT_BLOCKED / KADENCE_NOT_ACTIVE — same preconditions as
//     sync-palette
//
// This is a destructive action from the operator's POV (live palette
// on the WP site changes visibly). UI confirm modal names exact
// palette and WP URL before POSTing.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RollbackBodySchema = z.object({
  expected_site_version_lock: z.number().int().nonnegative(),
});

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
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["admin", "operator"] });
  if (gate.kind === "deny") return gate.response;

  const idCheck = validateUuidParam(params.id, "id");
  if (!idCheck.ok) return idCheck.response;

  const body = await readJsonBody(req);
  const parsed = parseBodyWith(RollbackBodySchema, body);
  if (!parsed.ok) return parsed.response;

  const preflightRes = await preflightSitePublish(idCheck.value);
  if (!preflightRes.ok) {
    return envelope(
      "PREFLIGHT_BLOCKED",
      preflightRes.blocker.detail,
      403,
      { blocker: preflightRes.blocker },
    );
  }

  const ctxRes = await buildPaletteSyncContext(idCheck.value);
  if (!ctxRes.ok) {
    if (ctxRes.code === "SITE_NOT_FOUND") {
      return envelope("NOT_FOUND", ctxRes.message, 404);
    }
    if (ctxRes.code === "SITE_CONFIG_MISSING" || ctxRes.code === "DS_NOT_FOUND") {
      return envelope(ctxRes.code, ctxRes.message, 409);
    }
    if (ctxRes.code === "KADENCE_NOT_ACTIVE") {
      return envelope("KADENCE_NOT_ACTIVE", ctxRes.message, 409, ctxRes.details);
    }
    if (ctxRes.code === "WP_AUTH_FAILED") {
      return envelope("AUTH_FAILED", ctxRes.message, 401, ctxRes.details);
    }
    if (ctxRes.code === "WP_REST_UNREACHABLE") {
      return envelope("WP_API_ERROR", ctxRes.message, 502, ctxRes.details);
    }
    return envelope("INTERNAL_ERROR", ctxRes.message, 500);
  }

  if (
    parsed.data.expected_site_version_lock !== ctxRes.ctx.site_version_lock
  ) {
    return envelope(
      "VERSION_CONFLICT",
      "The site row changed while you were preparing the rollback. Refresh the Appearance panel.",
      409,
      {
        expected: parsed.data.expected_site_version_lock,
        actual: ctxRes.ctx.site_version_lock,
      },
    );
  }

  const result = await rollbackPalette({
    ctx: ctxRes.ctx,
    expected_site_version_lock: parsed.data.expected_site_version_lock,
    requested_by: gate.user?.id ?? null,
  });

  if (!result.ok) {
    if (result.code === "NO_PRIOR_SNAPSHOT") {
      return envelope("NO_PRIOR_SNAPSHOT", result.message, 409);
    }
    if (result.code === "SNAPSHOT_MALFORMED") {
      return envelope(
        "SNAPSHOT_MALFORMED",
        result.message,
        500,
        result.details,
      );
    }
    if (result.code === "VERSION_CONFLICT") {
      return envelope("VERSION_CONFLICT", result.message, 409, result.details);
    }
    if (result.code === "WP_WRITE_FAILED") {
      return envelope("WP_API_ERROR", result.message, 502, result.details);
    }
    return envelope("INTERNAL_ERROR", result.message, 500);
  }

  revalidatePath(`/admin/sites/${idCheck.value}/appearance`);
  revalidatePath(`/admin/sites/${idCheck.value}`);

  return NextResponse.json(
    {
      ok: true,
      data: {
        outcome: result.code, // 'ROLLED_BACK' | 'ALREADY_ROLLED_BACK'
        rolled_back_at: result.rolled_back_at,
        reverted_from_event_id: result.reverted_from_event_id,
        new_site_version_lock: result.new_site_version_lock,
      },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
