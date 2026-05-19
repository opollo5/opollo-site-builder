import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import { createDraft, saveDraft, DraftDataSchema } from "@/lib/platform/social/drafts";

export interface PushCapPostResult {
  draftId: string;
}

export async function pushCapPostToComposer(
  postId: string,
  userId: string,
): Promise<PushCapPostResult> {
  const svc = getServiceRoleClient();

  // Load post with campaign + subscription → company_id
  const { data: post, error: postErr } = await svc
    .from("cap_campaign_posts")
    .select(
      `id, generated_content, generated_hashtags, generated_image_url,
       cap_campaigns:cap_campaign_id (
         cap_subscriptions:cap_subscription_id (
           company_id
         )
       )`,
    )
    .eq("id", postId)
    .single();

  if (postErr || !post) {
    throw new Error(`Campaign post not found: ${postId}`);
  }

  const campaign = Array.isArray(post.cap_campaigns) ? post.cap_campaigns[0] : post.cap_campaigns;
  const subscription = Array.isArray(campaign?.cap_subscriptions)
    ? campaign?.cap_subscriptions[0]
    : campaign?.cap_subscriptions;

  if (!subscription?.company_id) {
    throw new Error(`Post ${postId} has no resolvable company_id`);
  }

  const companyId = subscription.company_id as string;
  const content = (post.generated_content as string | null) ?? "";
  const hashtags = (post.generated_hashtags as string[] | null) ?? [];
  const imageUrl = post.generated_image_url as string | null;

  // Build the full post text: content + hashtags
  const hashtTagLine = hashtags.length > 0 ? `\n\n${hashtags.join(" ")}` : "";
  const masterText = content + hashtTagLine;

  // Create draft (idempotent via key)
  const idempotencyKey = `cap-post-${postId}`;
  const createResult = await createDraft({ companyId, userId, idempotencyKey });
  if (!createResult.ok) {
    throw new Error(`Failed to create draft: ${createResult.error.message}`);
  }

  const draft = createResult.data;

  // Build draft_data with content + optional image
  const mediaRefs = imageUrl
    ? [{ type: "ai_generated" as const, url: imageUrl, alt_text: "CAP generated image" }]
    : [];

  const draftData = DraftDataSchema.parse({
    master_text: masterText,
    media_refs: mediaRefs,
    ai_metadata: {
      prompt: "CAP generated",
      tone: "professional-friendly",
      generated_at: new Date().toISOString(),
    },
  });

  const saveResult = await saveDraft({
    draftId: draft.id,
    companyId,
    userId,
    expectedVersion: draft.draft_version,
    draftData,
  });

  if (!saveResult.ok) {
    if (saveResult.error.code === "VERSION_CONFLICT") {
      // Already saved, return existing
      logger.info("cap.push-to-composer.already_saved", { postId, draftId: draft.id });
    } else {
      throw new Error(`Failed to save draft: ${saveResult.error.message}`);
    }
  }

  // Link draft to cap_campaign_post
  await svc
    .from("cap_campaign_posts")
    .update({ social_draft_id: draft.id, status: "pushed" })
    .eq("id", postId);

  logger.info("cap.push-to-composer.complete", { postId, draftId: draft.id, companyId });

  return { draftId: draft.id };
}
