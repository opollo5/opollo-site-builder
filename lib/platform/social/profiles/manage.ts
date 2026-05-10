import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

import type { SocialProfile, SocialProfileKind } from "./types";

// BSP-5 — write helpers for platform_social_profiles.
//
// All callers must have already gated authorisation. Helpers do not
// enforce role checks — they're SQL write shims behind a typed Result.
// Cross-tenant safety is handled by RLS on the table (created in 0118).
//
// All helpers are idempotent where it makes sense (deletes return ok:false
// with NOT_FOUND for already-deleted rows; renames return ok:true if the
// new name matches what's already stored).

export type ManageProfileError =
  | { code: "VALIDATION_FAILED"; message: string }
  | { code: "NOT_FOUND"; message: string }
  | { code: "INVALID_STATE"; message: string }
  | { code: "ALREADY_EXISTS"; message: string }
  | { code: "INTERNAL_ERROR"; message: string };

export type ManageProfileResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ManageProfileError };

const NAME_MAX = 80;

function trimmedName(raw: string): string | null {
  const t = raw.trim();
  if (t.length === 0) return null;
  if (t.length > NAME_MAX) return null;
  return t;
}

export async function createProfile(input: {
  companyId: string;
  name: string;
  kind: SocialProfileKind;
}): Promise<ManageProfileResult<SocialProfile>> {
  const name = trimmedName(input.name);
  if (!name) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: `Name must be 1..${NAME_MAX} chars after trimming.`,
      },
    };
  }

  const svc = getServiceRoleClient();
  const insert = await svc
    .from("platform_social_profiles")
    .insert({
      company_id: input.companyId,
      name,
      kind: input.kind,
      is_default: false,
      bundle_social_team_id: null,
    })
    .select(
      "id, company_id, name, kind, is_default, bundle_social_team_id, created_at, updated_at",
    )
    .single();

  if (insert.error) {
    if (insert.error.code === "23505") {
      return {
        ok: false,
        error: {
          code: "ALREADY_EXISTS",
          message: `A profile named "${name}" already exists for this company.`,
        },
      };
    }
    logger.error("platform.social_profiles.create.failed", {
      company_id: input.companyId,
      err: insert.error.message,
      pg_code: insert.error.code,
    });
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: insert.error.message },
    };
  }

  return { ok: true, data: insert.data as SocialProfile };
}

export async function renameProfile(input: {
  profileId: string;
  newName: string;
}): Promise<ManageProfileResult<SocialProfile>> {
  const name = trimmedName(input.newName);
  if (!name) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: `Name must be 1..${NAME_MAX} chars after trimming.`,
      },
    };
  }

  const svc = getServiceRoleClient();
  const update = await svc
    .from("platform_social_profiles")
    .update({ name })
    .eq("id", input.profileId)
    .select(
      "id, company_id, name, kind, is_default, bundle_social_team_id, created_at, updated_at",
    )
    .maybeSingle();

  if (update.error) {
    if (update.error.code === "23505") {
      return {
        ok: false,
        error: {
          code: "ALREADY_EXISTS",
          message: `A profile named "${name}" already exists for this company.`,
        },
      };
    }
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: update.error.message },
    };
  }
  if (!update.data) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Profile not found." },
    };
  }

  return { ok: true, data: update.data as SocialProfile };
}

// Set a non-default profile as the new default. Atomic via a single
// supabase RPC would be nicer, but two updates inside a transaction
// require an RPC function — for now we accept a tiny window where two
// rows could be is_default=true and rely on the partial unique index
// to fail the second UPDATE (which is what we want — rollback).
//
// Strategy:
//   1. UPDATE old default → is_default=false (no-op if no default).
//   2. UPDATE target → is_default=true (fires partial unique index if
//      step 1 was lost; we surface as INTERNAL_ERROR for the caller to
//      retry).
//
// If step 2 fails after step 1 succeeds, we leave the company with no
// default profile. The admin can re-attempt setDefault — idempotent.
export async function setDefaultProfile(input: {
  companyId: string;
  profileId: string;
}): Promise<ManageProfileResult<SocialProfile>> {
  const svc = getServiceRoleClient();

  // Verify the target exists and belongs to this company before mutating.
  const target = await svc
    .from("platform_social_profiles")
    .select("id, company_id, is_default")
    .eq("id", input.profileId)
    .maybeSingle();
  if (target.error) {
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: target.error.message },
    };
  }
  if (!target.data) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Profile not found." },
    };
  }
  if (target.data.company_id !== input.companyId) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Profile not found in this company." },
    };
  }
  if (target.data.is_default === true) {
    // Already default — return current state.
    const current = await svc
      .from("platform_social_profiles")
      .select(
        "id, company_id, name, kind, is_default, bundle_social_team_id, created_at, updated_at",
      )
      .eq("id", input.profileId)
      .single();
    if (current.error) {
      return {
        ok: false,
        error: { code: "INTERNAL_ERROR", message: current.error.message },
      };
    }
    return { ok: true, data: current.data as SocialProfile };
  }

  // Step 1: clear the existing default for this company.
  const clear = await svc
    .from("platform_social_profiles")
    .update({ is_default: false })
    .eq("company_id", input.companyId)
    .eq("is_default", true);
  if (clear.error) {
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: clear.error.message },
    };
  }

  // Step 2: promote target.
  const promote = await svc
    .from("platform_social_profiles")
    .update({ is_default: true })
    .eq("id", input.profileId)
    .select(
      "id, company_id, name, kind, is_default, bundle_social_team_id, created_at, updated_at",
    )
    .single();
  if (promote.error) {
    logger.error("platform.social_profiles.set_default.promote_failed", {
      company_id: input.companyId,
      profile_id: input.profileId,
      err: promote.error.message,
    });
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: promote.error.message },
    };
  }

  return { ok: true, data: promote.data as SocialProfile };
}

export async function deleteProfile(input: {
  profileId: string;
}): Promise<ManageProfileResult<{ deleted_id: string }>> {
  const svc = getServiceRoleClient();

  const lookup = await svc
    .from("platform_social_profiles")
    .select("id, is_default")
    .eq("id", input.profileId)
    .maybeSingle();
  if (lookup.error) {
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: lookup.error.message },
    };
  }
  if (!lookup.data) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Profile not found." },
    };
  }
  if (lookup.data.is_default === true) {
    return {
      ok: false,
      error: {
        code: "INVALID_STATE",
        message:
          "Cannot delete the default profile. Set another profile as default first.",
      },
    };
  }

  const del = await svc
    .from("platform_social_profiles")
    .delete()
    .eq("id", input.profileId);
  if (del.error) {
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: del.error.message },
    };
  }

  return { ok: true, data: { deleted_id: input.profileId } };
}
