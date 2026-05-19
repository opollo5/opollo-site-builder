import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import { assertCostCapNotExceeded } from "@/lib/cap/cost-cap";
import { generatePost } from "@/lib/cap/generation/post-generator";
import { generateImageForPost } from "@/lib/cap/generation/image-orchestrator";

export interface RegeneratePostResult {
  postId: string;
  content: string;
  hashtags: string[];
  imageUrl: string;
}

export async function regeneratePost(
  campaignPostId: string,
  reason?: string,
): Promise<RegeneratePostResult> {
  const svc = getServiceRoleClient();

  const { data: post, error: postErr } = await svc
    .from("cap_campaign_posts")
    .select(
      `id, week_number, arc_phase, regenerate_count,
       cap_campaign_id,
       cap_campaigns:cap_campaign_id (
         month, monthly_objective, cap_subscription_id,
         cap_voice_profiles:voice_profile_id (
           tone, industry, target_audience, banned_words,
           on_brand_phrases, language_patterns, reference_posts
         )
       )`,
    )
    .eq("id", campaignPostId)
    .single();

  if (postErr || !post) {
    throw new Error(`Campaign post not found: ${campaignPostId}`);
  }

  const campaign = Array.isArray(post.cap_campaigns)
    ? post.cap_campaigns[0]
    : post.cap_campaigns;

  if (!campaign) {
    throw new Error(`Post ${campaignPostId} has no associated campaign`);
  }

  await assertCostCapNotExceeded(campaign.cap_subscription_id as string);

  if (reason) {
    logger.info("cap.regenerate-post.reason", { campaignPostId, reason: reason.slice(0, 200) });
  }

  const vp = Array.isArray(campaign.cap_voice_profiles)
    ? campaign.cap_voice_profiles[0]
    : campaign.cap_voice_profiles;

  if (!vp) {
    throw new Error(`Post ${campaignPostId} campaign has no voice profile`);
  }

  const voiceProfile = {
    tone: vp.tone as string,
    industry: vp.industry as string,
    targetAudience: vp.target_audience as string,
    bannedWords: (vp.banned_words as string[]) ?? [],
    onBrandPhrases: (vp.on_brand_phrases as string[]) ?? [],
    languagePatterns: (vp.language_patterns as Record<string, unknown>) ?? {},
    referencePosts: (vp.reference_posts as string[]) ?? [],
  };

  const textResult = await generatePost({
    campaignId: post.cap_campaign_id as string,
    postId: campaignPostId,
    weekNumber: post.week_number as 1 | 2 | 3 | 4,
    arcPhase: post.arc_phase as "awareness" | "education" | "offer" | "proof",
    monthlyObjective: campaign.monthly_objective as string,
    month: campaign.month as string,
    voiceProfile,
  });

  const imageResult = await generateImageForPost({
    campaignId: post.cap_campaign_id as string,
    postId: campaignPostId,
    arcPhase: post.arc_phase as "awareness" | "education" | "offer" | "proof",
    industry: voiceProfile.industry,
    postContent: textResult.content,
  });

  await svc
    .from("cap_campaign_posts")
    .update({
      generated_content: textResult.content,
      generated_hashtags: textResult.hashtags,
      generated_image_url: imageResult.url,
      status: "generated",
      regenerate_count: (post.regenerate_count as number) + 1,
    })
    .eq("id", campaignPostId);

  logger.info("cap.regenerate-post.complete", { campaignPostId });

  return {
    postId: campaignPostId,
    content: textResult.content,
    hashtags: textResult.hashtags,
    imageUrl: imageResult.url,
  };
}
