// Composer-layer types for the social-01 composer rebuild.
//
// CLAUDE-ASSUMPTION: Path is lib/social/ (new namespace for new composer)
// per COMPONENT_MAP.md §"File path summary". Existing publishing layer types
// remain in lib/platform/social/. Both coexist during cutover.
//
// CLAUDE-ASSUMPTION: Platform type uses brief's social_connections.platform
// values, not the existing SocialPlatform publishing-layer type.
//
export type Platform =
  | "linkedin"
  | "facebook"
  | "instagram"
  | "x"
  | "google_business_profile"
  | "pinterest"
  | "tiktok";

export type DraftState =
  | "draft"
  | "pending_approval"
  | "rejected"
  | "scheduled"
  | "recurring"
  | "paused"
  | "publishing"
  | "published"
  | "failed";

export type SchedulingMode = "post_now" | "schedule" | "recurring" | "draft";

export interface Connection {
  id: string;
  platform: Platform;
  account_name: string;
  account_avatar_url: string;
}

export interface Draft {
  id?: string; // undefined for new (unsaved) drafts
  draft_version?: number; // for CAS in PATCH — populated when editing an existing draft
  content: string;
  media_urls: string[];
  target_profile_ids: string[];
  platform_variants: Record<string, { content?: string; link?: string; cta?: string }>;
  approval_required: boolean;
  approver_user_id?: string;
  scheduled_at?: string | null; // ISO 8601 UTC — populated when editing a scheduled draft
  // Populated for state='published' rows so the read-only Post Info card
  // can render a "View on platform" link without an extra fetch.
  published_url?: string | null;
  published_at?: string | null;
}

export interface CalendarPost {
  id: string;
  state: DraftState;
  scheduled_at: string | null;
  published_at: string | null;
  content_excerpt: string;
  primary_media_url: string | null;
  link_url: string | null;
  target_profiles: Array<{ platform: Platform; account_avatar_url: string }>;
  is_recurring_child: boolean;
}

export interface RecurrenceRule {
  rule: string; // RFC 5545 RRULE string
  starting_at: string; // ISO 8601
  until?: string; // ISO 8601, absent = no end
}

// Full draft response shape from GET /api/platform/social/drafts/[id]
export interface DraftResponse {
  id: string;
  company_id: string;
  created_by: string;
  state: DraftState;
  content: string;
  media_urls: string[];
  target_profiles: Array<{
    profile_id: string;
    platform: Platform;
    account_name: string;
    account_avatar_url: string;
  }>;
  platform_variants: Record<string, { content?: string; link?: string; cta?: string }>;
  scheduled_at: string | null;
  planned_for_at: string | null;
  approval_required: boolean;
  approver_user_id: string | null;
  parent_draft_id: string | null;
  recurrence_rule: string | null;
  recurrence_state: "active" | "paused" | "ended" | null;
  occurrence_index: number | null;
  published_at: string | null;
  published_url: string | null;
  last_publish_error: {
    code: string;
    message: string;
    attempted_at: string;
    attempt_number: number;
  } | null;
  publish_attempts: number;
  created_at: string;
  updated_at: string;
}

// Per-platform character limits for content validation
export const PLATFORM_CHAR_LIMITS: Record<Platform, number> = {
  linkedin: 3000,
  facebook: 63206,
  instagram: 2200,
  x: 280,
  google_business_profile: 1500,
  pinterest: 500,
  tiktok: 2200,
};
