import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";

import type { SocialProfile } from "./types";

// BSP-3 — read helpers for platform_social_profiles.
//
// All reads use the service-role client so callers don't need to push
// RLS context — but every API route MUST have already gated on
// canDo("manage_connections") or membership before calling these.
// The helpers do not enforce auth themselves; they're SQL read shims.

export async function listProfilesForCompany(
  companyId: string,
): Promise<SocialProfile[]> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("platform_social_profiles")
    .select(
      "id, company_id, name, kind, is_default, bundle_social_team_id, created_at, updated_at",
    )
    .eq("company_id", companyId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(`listProfilesForCompany: ${error.message}`);
  }
  return (data ?? []) as SocialProfile[];
}

export async function getDefaultProfileForCompany(
  companyId: string,
): Promise<SocialProfile | null> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("platform_social_profiles")
    .select(
      "id, company_id, name, kind, is_default, bundle_social_team_id, created_at, updated_at",
    )
    .eq("company_id", companyId)
    .eq("is_default", true)
    .maybeSingle();
  if (error) {
    throw new Error(`getDefaultProfileForCompany: ${error.message}`);
  }
  return (data as SocialProfile | null) ?? null;
}

export async function getProfileById(
  profileId: string,
): Promise<SocialProfile | null> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("platform_social_profiles")
    .select(
      "id, company_id, name, kind, is_default, bundle_social_team_id, created_at, updated_at",
    )
    .eq("id", profileId)
    .maybeSingle();
  if (error) {
    throw new Error(`getProfileById: ${error.message}`);
  }
  return (data as SocialProfile | null) ?? null;
}
