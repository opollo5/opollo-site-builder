import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";

import type { BundlesocialPlatformType } from "./identity";
import type { SocialPlatform } from "./types";

// ---------------------------------------------------------------------------
// Shared loaders for the channel-selection API routes.
//
// Every per-connection route (channels GET, set-channel POST,
// unset-channel POST, connect-as-personal POST, disconnect POST) needs
// the same prep: load the row, resolve the bundle.social team_id from
// the row's profile_id, and map our SocialPlatform back to a
// BundlesocialPlatformType the SDK wrappers expect.
// ---------------------------------------------------------------------------

// Inverse of BUNDLE_TO_PLATFORM in sync.ts. Both linkedin_personal and
// linkedin_company funnel back to bundle.social's single LINKEDIN type
// — the personal-mode distinction lives in our DB only.
const PLATFORM_TO_BUNDLE: Record<SocialPlatform, BundlesocialPlatformType> = {
  linkedin_personal: "LINKEDIN",
  linkedin_company: "LINKEDIN",
  facebook_page: "FACEBOOK",
  x: "TWITTER",
  gbp: "GOOGLE_BUSINESS",
};

export function dbPlatformToBundleType(
  platform: SocialPlatform,
): BundlesocialPlatformType {
  return PLATFORM_TO_BUNDLE[platform];
}

export type LoadedConnection = {
  id: string;
  company_id: string;
  profile_id: string | null;
  platform: SocialPlatform;
  bundlePlatform: BundlesocialPlatformType;
  bundle_social_account_id: string;
  status: string;
  is_personal_mode: boolean;
  display_name: string | null;
  external_account_id: string | null;
  teamId: string;
};

export type LoadConnectionError =
  | { code: "NOT_FOUND"; message: string }
  | { code: "INVALID_STATE"; message: string };

// Load a social_connections row by id, resolve its bundle.social team
// via the profile_id → platform_social_profiles join, and map the
// platform enum back to the bundle.social type for SDK calls. Returns
// NOT_FOUND if the row or its team is missing.
export async function loadConnectionWithTeam(
  connectionId: string,
): Promise<
  { ok: true; data: LoadedConnection } | { ok: false; error: LoadConnectionError }
> {
  const svc = getServiceRoleClient();

  const connRead = await svc
    .from("social_connections")
    .select(
      "id, company_id, profile_id, platform, bundle_social_account_id, status, is_personal_mode, display_name, external_account_id",
    )
    .eq("id", connectionId)
    .maybeSingle();

  if (connRead.error || !connRead.data) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Connection not found." },
    };
  }

  const row = connRead.data as {
    id: string;
    company_id: string;
    profile_id: string | null;
    platform: SocialPlatform;
    bundle_social_account_id: string;
    status: string;
    is_personal_mode: boolean | null;
    display_name: string | null;
    external_account_id: string | null;
  };

  if (!row.profile_id) {
    return {
      ok: false,
      error: {
        code: "INVALID_STATE",
        message:
          "Connection has no profile_id — channel ops require a profile-scoped bundle.social team.",
      },
    };
  }

  const profileRead = await svc
    .from("platform_social_profiles")
    .select("bundle_social_team_id")
    .eq("id", row.profile_id)
    .maybeSingle();

  const teamId = (
    profileRead.data as { bundle_social_team_id?: string | null } | null
  )?.bundle_social_team_id;
  if (!teamId) {
    return {
      ok: false,
      error: {
        code: "INVALID_STATE",
        message: "Profile has no provisioned bundle.social team.",
      },
    };
  }

  return {
    ok: true,
    data: {
      id: row.id,
      company_id: row.company_id,
      profile_id: row.profile_id,
      platform: row.platform,
      bundlePlatform: dbPlatformToBundleType(row.platform),
      bundle_social_account_id: row.bundle_social_account_id,
      status: row.status,
      is_personal_mode: Boolean(row.is_personal_mode),
      display_name: row.display_name ?? null,
      external_account_id: row.external_account_id ?? null,
      teamId,
    },
  };
}
