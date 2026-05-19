import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

export type CampaignStatus =
  | "draft"
  | "generating"
  | "review"
  | "approved"
  | "pushed"
  | "published"
  | "archived"
  | "failed";

export type PostStatus =
  | "pending"
  | "generated"
  | "approved"
  | "rejected"
  | "pushed"
  | "published"
  | "failed"
  | "approved_past_due";

export interface CapCampaign {
  id: string;
  cap_subscription_id: string;
  voice_profile_id: string;
  month: string;
  monthly_objective: string;
  status: CampaignStatus;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CapCampaignPost {
  id: string;
  cap_campaign_id: string;
  week_number: 1 | 2 | 3 | 4;
  arc_phase: "awareness" | "education" | "offer" | "proof";
  generated_content: string | null;
  generated_image_url: string | null;
  generated_hashtags: string[];
  social_draft_id: string | null;
  status: PostStatus;
  rejection_reason: string | null;
  regenerate_count: number;
  created_at: string;
  updated_at: string;
}

export async function listCampaignsForSubscription(
  subscriptionId: string,
): Promise<CapCampaign[]> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("cap_campaigns")
    .select("*")
    .eq("cap_subscription_id", subscriptionId)
    .order("month", { ascending: false });

  if (error) {
    logger.warn("cap.campaigns.list_failed", { subscriptionId, error: error.message });
    return [];
  }
  return (data ?? []) as CapCampaign[];
}

export async function getCampaign(campaignId: string): Promise<CapCampaign | null> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("cap_campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();

  if (error) {
    logger.warn("cap.campaigns.get_failed", { campaignId, error: error.message });
    return null;
  }
  return data as CapCampaign | null;
}

export async function listPostsForCampaign(campaignId: string): Promise<CapCampaignPost[]> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("cap_campaign_posts")
    .select("*")
    .eq("cap_campaign_id", campaignId)
    .order("week_number", { ascending: true });

  if (error) {
    logger.warn("cap.campaigns.list_posts_failed", { campaignId, error: error.message });
    return [];
  }
  return (data ?? []) as CapCampaignPost[];
}

export async function updateCampaignPostStatus(
  postId: string,
  status: PostStatus,
  rejectionReason?: string,
): Promise<void> {
  const svc = getServiceRoleClient();
  const patch: Record<string, unknown> = { status };
  if (rejectionReason !== undefined) patch.rejection_reason = rejectionReason;

  const { error } = await svc
    .from("cap_campaign_posts")
    .update(patch)
    .eq("id", postId);

  if (error) {
    throw new Error(`Failed to update post status: ${error.message}`);
  }
}
