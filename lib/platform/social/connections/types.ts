// Mirrors social_platform + social_connection_status enums in 0070.
// Keep aligned: extending requires a forward-only migration AND extending
// these literal unions; TypeScript catches the gap at compile time.

import {
  PLATFORM_LABEL,
  type SocialPlatform,
} from "@/lib/platform/social/variants/types";

export type SocialConnectionStatus =
  | "healthy"
  | "degraded"
  | "auth_required"
  | "disconnected";

export type SocialConnection = {
  id: string;
  company_id: string;
  // BSP-8 — non-null after the 0120 backfill. NULL is possible if a
  // profile was deleted before its connections were reattributed; the
  // next sync re-resolves attribution via team_id → profile lookup.
  profile_id: string | null;
  platform: SocialPlatform;
  bundle_social_account_id: string;
  display_name: string | null;
  avatar_url: string | null;
  status: SocialConnectionStatus;
  last_error: string | null;
  connected_at: string;
  disconnected_at: string | null;
  last_health_check_at: string;
  created_at: string;
  updated_at: string;
};

export type ListConnectionsInput = {
  companyId: string;
  // BSP-8 — optional per-profile filter for the customer UI. When set,
  // only returns connections attributed to this profile.
  profileId?: string;
};

// UI helpers.
export const STATUS_LABEL: Record<SocialConnectionStatus, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  auth_required: "Reconnect required",
  disconnected: "Disconnected",
};

export const STATUS_PILL: Record<SocialConnectionStatus, string> = {
  healthy: "bg-emerald-100 text-emerald-900",
  degraded: "bg-amber-100 text-amber-900",
  auth_required: "bg-rose-100 text-rose-900",
  disconnected: "bg-muted text-muted-foreground",
};

// Re-export so consumers don't need to dive into variants/types just
// for the platform label map.
export { PLATFORM_LABEL };
export type { SocialPlatform };
