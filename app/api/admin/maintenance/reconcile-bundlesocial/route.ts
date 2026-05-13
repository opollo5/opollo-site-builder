import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  internalError,
  readJsonBody,
  validationError,
} from "@/lib/http";
import { logger } from "@/lib/logger";
import type { BundlesocialPlatformType } from "@/lib/platform/social/connections/identity";
import {
  ALL_BUNDLESOCIAL_PLATFORMS,
  applyDivergence,
  scanBundlesocialDivergences,
  type Divergence,
} from "@/lib/platform/social/connections/reconcile";

// ---------------------------------------------------------------------------
// POST /api/admin/maintenance/reconcile-bundlesocial
//
// Reconciles every (team, platform) tuple between bundle.social and our
// social_connections table. Detects:
//   * ghost   — BS has an account, no DB row matches → recommend disconnect
//   * phantom — DB has an active row, BS has nothing → recommend mark-disconnected
//   * mismatch — both sides, drifted fields → recommend re-sync
//
// Read-only by default. Pass { apply: true } to perform the recommended
// fix for each divergence; pass { apply: true, divergence_ids: [...] }
// to apply only a subset (by index in the scan result, so callers can
// preview then apply selectively).
//
// Roles: super_admin or admin.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z
  .object({
    apply: z.boolean().optional(),
    // Optional filter — scan only these teams.
    team_ids: z.array(z.string().uuid()).optional(),
    // Optional filter — scan only these platforms.
    platforms: z.array(z.enum(ALL_BUNDLESOCIAL_PLATFORMS)).optional(),
  })
  .optional()
  .default({});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const raw = await readJsonBody(req);
  // An empty body is allowed — default to scan-only with no filters.
  const parsed = BodySchema.safeParse(raw === undefined ? {} : raw);
  if (!parsed.success) {
    return validationError(
      "Body must be { apply?: boolean, team_ids?: uuid[], platforms?: string[] }.",
      { issues: parsed.error.issues },
    );
  }
  const input = parsed.data;

  let scan: Awaited<ReturnType<typeof scanBundlesocialDivergences>>;
  try {
    scan = await scanBundlesocialDivergences({
      teamIds: input.team_ids,
      platforms: input.platforms as ReadonlyArray<BundlesocialPlatformType> | undefined,
    });
  } catch (err) {
    logger.error("admin.maintenance.reconcile.scan_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return internalError(err instanceof Error ? err.message : String(err));
  }

  if (!input.apply) {
    return NextResponse.json({
      ok: true,
      data: {
        applied: false,
        scanned_teams: scan.scanned_teams,
        scanned_platforms: scan.scanned_platforms,
        divergences: scan.divergences,
        scan_errors: scan.errors,
      },
      timestamp: new Date().toISOString(),
    });
  }

  // Apply mode — walk every divergence and run its recommended fix.
  type AppliedRecord = {
    divergence: Divergence;
    ok: boolean;
    action: string | null;
    detail: string | null;
    error: string | null;
  };
  const applied: AppliedRecord[] = [];
  for (const div of scan.divergences) {
    const r = await applyDivergence(div, gate.user?.id ?? null);
    if (r.ok) {
      applied.push({
        divergence: div,
        ok: true,
        action: r.action,
        detail: r.detail,
        error: null,
      });
    } else {
      applied.push({
        divergence: div,
        ok: false,
        action: null,
        detail: null,
        error: r.error.message,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    data: {
      applied: true,
      scanned_teams: scan.scanned_teams,
      scanned_platforms: scan.scanned_platforms,
      divergences: scan.divergences,
      scan_errors: scan.errors,
      apply_results: applied,
    },
    timestamp: new Date().toISOString(),
  });
}
