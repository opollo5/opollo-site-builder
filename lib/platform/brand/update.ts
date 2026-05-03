import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

import { getActiveBrandProfile } from "./get";
import { BRAND_PROFILE_COLUMNS, type BrandProfile } from "./types";

// Brand-profile mutation contract:
//
//   1. Customer companies start without any brand profile (only the
//      Opollo internal seed has one). The first edit creates the v1
//      row; subsequent edits go through the versioned RPC.
//
//   2. Once an active row exists, NEVER UPDATE it directly — call the
//      `update_brand_profile()` RPC. The RPC flips is_active=false on
//      the current row and inserts a new row (version+1, is_active=true)
//      in one statement-level transaction. Concurrent readers always
//      see exactly one active row (UNIQUE(company_id) WHERE is_active=
//      true is the schema-level safety net).
//
//   3. content_restrictions is special — only Opollo staff may modify
//      it. The route handler enforces that gate before this function
//      is called; the lib layer does not re-check (single trust layer
//      to keep test seams simple).

// Patchable subset of BrandProfile. Fields the operator can submit to
// either create-or-update. Includes all editor-relevant columns. The
// audit/identity columns (id, version, is_active, created_at, etc.)
// are not patchable.
export type BrandProfilePatch = Partial<
  Pick<
    BrandProfile,
    | "primary_colour"
    | "secondary_colour"
    | "accent_colour"
    | "logo_primary_url"
    | "logo_dark_url"
    | "logo_light_url"
    | "logo_icon_url"
    | "heading_font"
    | "body_font"
    | "image_style"
    | "approved_style_ids"
    | "safe_mode"
    | "personality_traits"
    | "formality"
    | "point_of_view"
    | "preferred_vocabulary"
    | "avoided_terms"
    | "voice_examples"
    | "focus_topics"
    | "avoided_topics"
    | "industry"
    | "default_approval_required"
    | "default_approval_rule"
    | "platform_overrides"
    | "hashtag_strategy"
    | "max_post_length"
    | "content_restrictions"
  >
>;

export type BrandUpdateError =
  | { code: "VALIDATION_FAILED"; message: string }
  | { code: "INTERNAL_ERROR"; message: string };

export type BrandUpdateResult =
  | { ok: true; brand: BrandProfile; created: boolean }
  | { ok: false; error: BrandUpdateError };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Bootstraps the v1 profile when none exists, or routes through the
// versioning RPC when one does. Returns `{created: true}` on first
// insert so callers can surface different success copy ("Profile
// created" vs "Profile updated to v2").
export async function updateBrandProfile(args: {
  companyId: string;
  updatedBy: string;
  changeSummary: string | null;
  fields: BrandProfilePatch;
}): Promise<BrandUpdateResult> {
  if (!UUID_RE.test(args.companyId)) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "company_id must be a UUID.",
      },
    };
  }
  if (!UUID_RE.test(args.updatedBy)) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "updated_by must be a UUID.",
      },
    };
  }

  const existing = await getActiveBrandProfile(args.companyId);
  if (existing === null) {
    return await createInitialBrandProfile(args);
  }
  return await callUpdateRpc(args);
}

async function createInitialBrandProfile(args: {
  companyId: string;
  updatedBy: string;
  changeSummary: string | null;
  fields: BrandProfilePatch;
}): Promise<BrandUpdateResult> {
  const svc = getServiceRoleClient();

  // Initial insert: version=1, is_active=true. The unique-active
  // partial index means a concurrent insert race for the same
  // company_id will fail one of the two writes — return INTERNAL_ERROR
  // and let the client refresh + retry. Truly concurrent first-edit
  // is operationally rare (one operator, one form), but the schema
  // guarantee removes it as a correctness concern.
  const { data, error } = await svc
    .from("platform_brand_profiles")
    .insert({
      company_id: args.companyId,
      version: 1,
      is_active: true,
      change_summary: args.changeSummary ?? "Initial brand profile",
      created_by: args.updatedBy,
      updated_by: args.updatedBy,
      ...sanitisePatch(args.fields),
    })
    .select(BRAND_PROFILE_COLUMNS)
    .single();

  if (error) {
    logger.error("platform.brand.update.initial_insert_failed", {
      companyId: args.companyId,
      err: error.message,
    });
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: error.message },
    };
  }

  return { ok: true, brand: data as unknown as BrandProfile, created: true };
}

async function callUpdateRpc(args: {
  companyId: string;
  updatedBy: string;
  changeSummary: string | null;
  fields: BrandProfilePatch;
}): Promise<BrandUpdateResult> {
  const svc = getServiceRoleClient();

  // The RPC accepts a JSONB blob; supabase-js sends it as JSON. We pass
  // only the keys the operator submitted (sanitisePatch) so the RPC's
  // COALESCE-against-current carries forward unchanged fields without
  // an explicit write.
  const { data, error } = await svc.rpc("update_brand_profile", {
    p_company_id: args.companyId,
    p_updated_by: args.updatedBy,
    p_change_summary: args.changeSummary,
    p_fields: sanitisePatch(args.fields),
  });

  if (error) {
    logger.error("platform.brand.update.rpc_failed", {
      companyId: args.companyId,
      err: error.message,
    });
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: error.message },
    };
  }

  // The RPC returns the new active row. supabase-js wraps single-row
  // RETURNING from a SETOF/RECORD-returning function as the row object
  // directly when called via .rpc() — same shape as a SELECT.
  return {
    ok: true,
    brand: data as unknown as BrandProfile,
    created: false,
  };
}

// Strip undefined keys so the JSONB payload sent to the RPC contains
// only what the operator submitted. The RPC uses COALESCE(p_fields->>x,
// cur.x), so explicit-null values (e.g. clearing a logo) ride through;
// undefined keys never make it into JSON, which is what we want.
function sanitisePatch(p: BrandProfilePatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}
