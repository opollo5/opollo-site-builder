import type { SocialPlatform } from "@/lib/platform/social/variants/types";

// Shapes mirror the columns in migration 0121. Defined here so both the
// ingest writers and the dashboard readers consume the same types.

export type ProfileAnalyticsPeriodKind = "rolling" | "lifetime" | "snapshot";

export type ProfileAnalyticsSnapshot = {
  id: string;
  profile_id: string;
  platform: SocialPlatform;
  bundle_social_account_id: string;
  snapshot_date: string;
  period_kind: ProfileAnalyticsPeriodKind;
  followers: number | null;
  following: number | null;
  post_count: number | null;
  impressions: number | null;
  impressions_unique: number | null;
  views: number | null;
  views_unique: number | null;
  likes: number | null;
  comments: number | null;
  raw: unknown;
  created_at: string;
  updated_at: string;
};

export type PostAnalyticsSnapshot = {
  id: string;
  profile_id: string;
  bundle_post_id: string;
  platform: SocialPlatform;
  bundle_social_account_id: string | null;
  snapshot_date: string;
  posted_at: string | null;
  post_url: string | null;
  title: string | null;
  content: string | null;
  media_urls: string[] | null;
  impressions: number | null;
  impressions_unique: number | null;
  views: number | null;
  views_unique: number | null;
  likes: number | null;
  dislikes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  engagement_rate: number | null;
  raw: unknown;
  created_at: string;
  updated_at: string;
};

export type PostHistoryImportStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "timeout";

export type PostHistoryImport = {
  id: string;
  profile_id: string;
  bundle_social_account_id: string;
  platform: SocialPlatform;
  status: PostHistoryImportStatus;
  bundle_import_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  posts_imported: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};
