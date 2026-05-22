import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import { assertCostCapNotExceeded } from "@/lib/cap/cost-cap";
import { generatePost } from "@/lib/cap/generation/post-generator";
import { generateImageForPost } from "@/lib/cap/generation/image-orchestrator";

const ARC_PHASES = [
  { weekNumber: 1 as const, arcPhase: "awareness" as const },
  { weekNumber: 2 as const, arcPhase: "education" as const },
  { weekNumber: 3 as const, arcPhase: "offer" as const },
  { weekNumber: 4 as const, arcPhase: "proof" as const },
];

export interface RunCampaignResult {
  campaignId: string;
  postsGenerated: number;
  status: "review" | "failed";
}

export async function runCampaign(campaignId: string): Promise<RunCampaignResult> {
  const svc = getServiceRoleClient();

  // Load campaign with voice profile + subscription
  const { data: campaign, error: campaignErr } = await svc
    .from("cap_campaigns")
    .select(
      `id, month, monthly_objective, status, cap_subscription_id,
       cap_voice_profiles:voice_profile_id (
         tone, industry, target_audience, banned_words,
         on_brand_phrases, language_patterns, reference_posts
       ),
       cap_subscriptions:cap_subscription_id ( id, company_id )`,
    )
    .eq("id", campaignId)
    .single();

  if (campaignErr || !campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }

  // Cost cap check
  await assertCostCapNotExceeded(campaign.cap_subscription_id);

  // Transition to generating
  await svc
    .from("cap_campaigns")
    .update({ status: "generating" })
    .eq("id", campaignId);

  logger.info("cap.campaign-runner.start", { campaignId });

  // Upsert 4 pending posts (idempotent — UNIQUE on (cap_campaign_id, week_number))
  const pendingPosts = ARC_PHASES.map((p) => ({
    cap_campaign_id: campaignId,
    week_number: p.weekNumber,
    arc_phase: p.arcPhase,
    status: "pending" as const,
    generated_content: null,
    generated_image_url: null,
    generated_hashtags: [] as string[],
  }));

  const { data: upsertedPosts, error: upsertErr } = await svc
    .from("cap_campaign_posts")
    .upsert(pendingPosts, { onConflict: "cap_campaign_id,week_number" })
    .select("id, week_number, arc_phase");

  if (upsertErr || !upsertedPosts) {
    await svc.from("cap_campaigns").update({ status: "failed" }).eq("id", campaignId);
    throw new Error(`Failed to upsert campaign posts: ${upsertErr?.message}`);
  }

  const vp = Array.isArray(campaign.cap_voice_profiles)
    ? campaign.cap_voice_profiles[0]
    : campaign.cap_voice_profiles;

  if (!vp) {
    await svc.from("cap_campaigns").update({ status: "failed" }).eq("id", campaignId);
    throw new Error(`Campaign ${campaignId} has no voice profile`);
  }

  const sub = Array.isArray(campaign.cap_subscriptions)
    ? campaign.cap_subscriptions[0]
    : campaign.cap_subscriptions;
  const companyId =
    (sub as { id: string; company_id: string } | null)?.company_id ?? "";

  const voiceProfile = {
    tone: vp.tone as string,
    industry: vp.industry as string,
    targetAudience: vp.target_audience as string,
    bannedWords: (vp.banned_words as string[]) ?? [],
    onBrandPhrases: (vp.on_brand_phrases as string[]) ?? [],
    languagePatterns: (vp.language_patterns as Record<string, unknown>) ?? {},
    referencePosts: (vp.reference_posts as string[]) ?? [],
  };

  let postsGenerated = 0;

  for (const post of upsertedPosts) {
    try {
      const textResult = await generatePost({
        campaignId,
        postId: post.id as string,
        companyId,
        weekNumber: post.week_number as 1 | 2 | 3 | 4,
        arcPhase: post.arc_phase as "awareness" | "education" | "offer" | "proof",
        monthlyObjective: campaign.monthly_objective as string,
        month: campaign.month as string,
        voiceProfile,
      });

      const imageResult = await generateImageForPost({
        campaignId,
        postId: post.id as string,
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
        })
        .eq("id", post.id);

      postsGenerated++;
      logger.info("cap.campaign-runner.post_generated", { campaignId, postId: post.id, week: post.week_number });
    } catch (err) {
      logger.error("cap.campaign-runner.post_failed", {
        campaignId,
        postId: post.id,
        error: err instanceof Error ? err.message : String(err),
      });

      await svc
        .from("cap_campaign_posts")
        .update({ status: "failed" })
        .eq("id", post.id);

      await svc.from("cap_campaigns").update({ status: "failed" }).eq("id", campaignId);
      throw err;
    }
  }

  await svc.from("cap_campaigns").update({ status: "review" }).eq("id", campaignId);
  logger.info("cap.campaign-runner.complete", { campaignId, postsGenerated });

  return { campaignId, postsGenerated, status: "review" };
}
