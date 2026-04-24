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
  confirmedPaletteSync,
  paletteDryRunFromContext,
} from "@/lib/kadence-palette-sync";
import { preflightSitePublish } from "@/lib/site-preflight";

// ---------------------------------------------------------------------------
// M13-5c — POST /api/sites/[id]/appearance/sync-palette
//
// Two modes:
//
//   mode=dry_run (default)
//     Reads WP + DS, returns { proposal, diff, current_palette_sha }.
//     ZERO writes. The sha returned here MUST be echoed in the
//     subsequent mode=confirmed call so we can detect operator edits
//     to WP Customizer between preview and confirm.
//
//   mode=confirmed
//     Writes the proposal to WP, CAS-stamps
//     sites.kadence_globals_synced_at, and audits. Body requires:
//       - expected_site_version_lock: int
//       - expected_current_palette_sha: string (from dry-run)
//
// Write-safety contract (Steven's 6-point requirement):
//   ✔ Dry-run first, always previewable before write
//   ✔ Confirm modal naming WP URL + mutation (UI layer; route still
//     requires mode='confirmed' as explicit opt-in)
//   ✔ Idempotency on re-run: empty diff → ALREADY_SYNCED, no WP write
//   ✔ Rollback path: previous_palette snapshot in globals_completed
//     (see /rollback-palette)
//   ✔ version_lock CAS on sites.kadence_globals_synced_at
//   ✔ Audit event per step (globals_dry_run / globals_confirmed /
//     globals_completed / globals_failed / drift-failure / WP-failure)
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SyncPaletteBodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("dry_run") }),
  z.object({
    mode: z.literal("confirmed"),
    expected_site_version_lock: z.number().int().nonnegative(),
    expected_current_palette_sha: z.string().min(32).max(256),
  }),
]);

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
  const parsed = parseBodyWith(SyncPaletteBodySchema, body);
  if (!parsed.ok) return parsed.response;

  // Preflight — same gate as M13-4 publish. Missing caps → 403 blocker
  // before any WP read.
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

  if (parsed.data.mode === "dry_run") {
    const preview = paletteDryRunFromContext(ctxRes.ctx);
    return NextResponse.json(
      {
        ok: true,
        data: {
          mode: "dry_run",
          install: preview.install,
          current_palette: preview.current_palette,
          current_palette_sha: preview.current_palette_sha,
          proposal: preview.proposal,
          diff: preview.diff,
          already_synced: preview.already_synced,
          site_version_lock: ctxRes.ctx.site_version_lock,
          wp_url: ctxRes.ctx.site_wp_url,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  }

  // mode === 'confirmed' — validate site_version_lock matches before
  // we touch WP. Stale → reject without a mutation.
  if (parsed.data.expected_site_version_lock !== ctxRes.ctx.site_version_lock) {
    return envelope(
      "VERSION_CONFLICT",
      "The site row changed between your preview and confirm. Refresh the Appearance panel and re-run the dry-run before syncing.",
      409,
      {
        expected: parsed.data.expected_site_version_lock,
        actual: ctxRes.ctx.site_version_lock,
      },
    );
  }

  const result = await confirmedPaletteSync({
    ctx: ctxRes.ctx,
    expected_current_palette_sha: parsed.data.expected_current_palette_sha,
    confirmed_by: gate.user?.id ?? null,
  });

  if (!result.ok) {
    if (result.code === "WP_STATE_DRIFTED") {
      return envelope(
        "WP_STATE_DRIFTED",
        result.message,
        409,
        result.details,
      );
    }
    if (result.code === "PROPOSAL_INSUFFICIENT") {
      return envelope(
        "PROPOSAL_INSUFFICIENT",
        result.message,
        409,
        result.details,
      );
    }
    if (result.code === "VERSION_CONFLICT") {
      return envelope("VERSION_CONFLICT", result.message, 409);
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
        mode: "confirmed",
        outcome: result.code, // 'SYNCED' | 'ALREADY_SYNCED'
        synced_at: result.synced_at,
        new_site_version_lock: result.new_site_version_lock,
        appearance_event_id: result.appearance_event_id,
        round_trip_ok: result.round_trip_ok,
      },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
