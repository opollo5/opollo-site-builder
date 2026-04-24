import "server-only";

import { z } from "zod";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// M12-2 — site_conventions zod schema + anchor-cycle freeze helper.
//
// `site_conventions` is the per-brief, frozen design+content contract that
// the M12-3 runner resolves during page 1's anchor cycle and re-uses
// verbatim for pages 2..N. The table was created in 0013 (M12-1); this
// module ships the write-path scaffold the runner will call.
//
// Contract per docs/plans/m12-parent.md §Site-conventions capture +
// §First-page anchor:
//
//   1. Written exactly once per brief. The runner's anchor cycle resolves
//      the conventions, then calls `freezeSiteConventions()` once.
//
//   2. Frozen rows are not updated. `freezeSiteConventions()` is
//      idempotent: a repeat call (e.g. after a worker crash mid-freeze)
//      reads the existing row, confirms frozen_at is set, and returns
//      `wasAlreadyFrozen: true`. It does NOT overwrite.
//
//   3. Concurrent callers (two runners racing the same brief) are
//      structurally impossible — the partial UNIQUE index
//      `brief_runs_one_active_per_brief` rejects the second runner's
//      lease. But if that invariant ever breaks, the UNIQUE constraint
//      on `site_conventions.brief_id` is the last-resort guard: one
//      INSERT wins, the second gets 23505 and we read the winner's row.
//
// ANCHOR_EXTRA_CYCLES lives here because it's a cross-slice constant —
// M12-3 reads it in the runner loop, M12-2 ships it with the module that
// owns the conventions write path. Two (not three) extra cycles keeps
// the anchor cost bounded at 2× standard per-page cost while still
// giving Claude two revise passes to stabilise voice + layout before
// pages 2..N inherit.
// ---------------------------------------------------------------------------

export const ANCHOR_EXTRA_CYCLES = 2;

// Zod schema for the conventions payload. Every field is optional — the
// anchor cycle may resolve some fields but not others (e.g. a brief that
// doesn't specify CTA language won't produce a cta_phrasing entry). The
// runner treats NULL/undefined as "no constraint" and lets Claude choose
// per-page. `additional` is the escape hatch for conventions the anchor
// cycle discovers that don't fit the typed columns.
//
// Structured fields (cta_phrasing, color_role_map) are left permissive
// in M12-2 because M12-3's eval experiments are what will lock the
// shapes. Tightening the schema is cheap once we know what Claude
// actually produces.
export const SiteConventionsSchema = z.object({
  typographic_scale: z.string().nullable().optional(),
  section_rhythm: z.string().nullable().optional(),
  hero_pattern: z.string().nullable().optional(),
  cta_phrasing: z.record(z.string(), z.unknown()).nullable().optional(),
  color_role_map: z.record(z.string(), z.unknown()).nullable().optional(),
  tone_register: z.string().nullable().optional(),
  additional: z.record(z.string(), z.unknown()).optional().default({}),
});

export type SiteConventions = z.infer<typeof SiteConventionsSchema>;

export type SiteConventionsRow = SiteConventions & {
  id: string;
  brief_id: string;
  frozen_at: string | null;
  version_lock: number;
  created_at: string;
  updated_at: string;
};

export type FreezeSiteConventionsOk = {
  ok: true;
  row: SiteConventionsRow;
  wasAlreadyFrozen: boolean;
};

export type FreezeSiteConventionsFail = {
  ok: false;
  code: "VALIDATION_FAILED" | "NOT_FOUND" | "INTERNAL_ERROR";
  message: string;
  details?: Record<string, unknown>;
};

export type FreezeSiteConventionsResult =
  | FreezeSiteConventionsOk
  | FreezeSiteConventionsFail;

/**
 * Freeze the site_conventions row for a brief. The runner calls this
 * exactly once at the end of page 1's anchor cycle. Subsequent calls
 * (e.g. a worker restart replaying the freeze step) return
 * `wasAlreadyFrozen: true` without mutating the row.
 *
 * Semantics:
 *   - First call with no existing row → INSERT with frozen_at=now(),
 *     returns { wasAlreadyFrozen: false, row: ... }.
 *   - Repeat call (existing row) → reads the existing row, returns
 *     { wasAlreadyFrozen: true, row: ... }. Input is ignored; the first
 *     freeze is authoritative.
 *   - Brief does not exist → NOT_FOUND.
 *   - Invalid conventions payload → VALIDATION_FAILED.
 *
 * Service-role client is used throughout (the runner has no user
 * session; it's a background worker). Admin gating is upstream of this
 * helper.
 */
export async function freezeSiteConventions(params: {
  briefId: string;
  conventions: unknown;
  userId?: string | null;
}): Promise<FreezeSiteConventionsResult> {
  const parsed = SiteConventionsSchema.safeParse(params.conventions);
  if (!parsed.success) {
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      message: "site_conventions payload failed schema validation.",
      details: { issues: parsed.error.issues },
    };
  }

  const svc = getServiceRoleClient();

  // Confirm the brief exists before the INSERT so a missing brief
  // surfaces as NOT_FOUND rather than an FK-violation INTERNAL_ERROR.
  const briefLookup = await svc
    .from("briefs")
    .select("id")
    .eq("id", params.briefId)
    .maybeSingle();
  if (briefLookup.error) {
    logger.error("site_conventions.freeze.brief_lookup_failed", {
      brief_id: params.briefId,
      error: briefLookup.error,
    });
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message:
        "Failed to look up the brief. Please try again or contact support with the request id from the response headers.",
    };
  }
  if (!briefLookup.data) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: `No brief with id ${params.briefId}.`,
    };
  }

  const data = parsed.data;
  const nowIso = new Date().toISOString();
  const userId = params.userId ?? null;

  // INSERT with conflict-on-brief_id short-circuit. `frozen_at` is set
  // on insert so the existence of a row implies a completed freeze.
  // ON CONFLICT (brief_id) DO NOTHING means a second caller gets 0 rows
  // returned; we then SELECT the winner's row below.
  const insertRes = await svc
    .from("site_conventions")
    .insert({
      brief_id: params.briefId,
      typographic_scale: data.typographic_scale ?? null,
      section_rhythm: data.section_rhythm ?? null,
      hero_pattern: data.hero_pattern ?? null,
      cta_phrasing: data.cta_phrasing ?? null,
      color_role_map: data.color_role_map ?? null,
      tone_register: data.tone_register ?? null,
      additional: data.additional ?? {},
      frozen_at: nowIso,
      created_by: userId,
      updated_by: userId,
    })
    .select(
      "id, brief_id, typographic_scale, section_rhythm, hero_pattern, cta_phrasing, color_role_map, tone_register, additional, frozen_at, version_lock, created_at, updated_at",
    )
    .maybeSingle();

  if (insertRes.error) {
    // 23505 — UNIQUE violation on brief_id → another caller raced us.
    // PostgREST wraps this as error.code === "23505"; fall through to
    // the SELECT below.
    if ((insertRes.error.code as string | undefined) !== "23505") {
      logger.error("site_conventions.freeze.insert_failed", {
        brief_id: params.briefId,
        error: insertRes.error,
      });
      return {
        ok: false,
        code: "INTERNAL_ERROR",
        message:
          "Failed to freeze conventions. Please try again or contact support with the request id from the response headers.",
      };
    }
  } else if (insertRes.data) {
    // Happy path: we won the INSERT race.
    return {
      ok: true,
      row: insertRes.data as SiteConventionsRow,
      wasAlreadyFrozen: false,
    };
  }

  // Either the INSERT conflicted (23505) or it returned no data (same
  // effective state — another writer got there). Read the existing row.
  const readRes = await svc
    .from("site_conventions")
    .select(
      "id, brief_id, typographic_scale, section_rhythm, hero_pattern, cta_phrasing, color_role_map, tone_register, additional, frozen_at, version_lock, created_at, updated_at",
    )
    .eq("brief_id", params.briefId)
    .maybeSingle();

  if (readRes.error) {
    logger.error("site_conventions.freeze.post_conflict_read_failed", {
      brief_id: params.briefId,
      error: readRes.error,
    });
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message:
        "Failed to read the frozen conventions row. Please try again or contact support with the request id from the response headers.",
    };
  }
  if (!readRes.data) {
    // UNIQUE violation but no row present: bizarre race that shouldn't
    // be reachable (DELETE + INSERT between our two queries). Surface
    // as INTERNAL_ERROR so the runner retries.
    logger.error("site_conventions.freeze.ghost_row", {
      brief_id: params.briefId,
    });
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message:
        "Conventions row vanished between conflict and read. Please retry.",
    };
  }

  return {
    ok: true,
    row: readRes.data as SiteConventionsRow,
    wasAlreadyFrozen: true,
  };
}

/**
 * Read the site_conventions row for a brief. Returns null when no row
 * exists yet (anchor cycle hasn't run, or it's a brief from before
 * M12-3 shipped). Service-role client; admin gating is upstream.
 */
export async function getSiteConventions(
  briefId: string,
): Promise<SiteConventionsRow | null> {
  const svc = getServiceRoleClient();
  const res = await svc
    .from("site_conventions")
    .select(
      "id, brief_id, typographic_scale, section_rhythm, hero_pattern, cta_phrasing, color_role_map, tone_register, additional, frozen_at, version_lock, created_at, updated_at",
    )
    .eq("brief_id", briefId)
    .maybeSingle();
  if (res.error) {
    logger.error("site_conventions.read_failed", {
      brief_id: briefId,
      error: res.error,
    });
    throw new Error(
      `getSiteConventions(${briefId}): ${res.error.message}`,
    );
  }
  return (res.data as SiteConventionsRow | null) ?? null;
}
