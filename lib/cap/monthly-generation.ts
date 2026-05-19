import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import { runCampaign } from "@/lib/cap/generation/campaign-runner";

export interface MonthlyGenerationResult {
  subscriptionsProcessed: number;
  campaignsCreated: number;
  campaignsGenerated: number;
  failed: number;
}

export async function runMonthlyCapGeneration(): Promise<MonthlyGenerationResult> {
  const svc = getServiceRoleClient();

  // Get the first day of the current month as the campaign month
  const now = new Date();
  const campaignMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);

  // Find active/trial subscriptions with at least one voice profile
  const { data: subscriptions, error: subErr } = await svc
    .from("cap_subscriptions")
    .select(
      `id, company_id,
       cap_voice_profiles!cap_voice_profiles_cap_subscription_id_fkey(id, is_default)`,
    )
    .in("status", ["active", "trial"]);

  if (subErr) {
    logger.error("cap.monthly-gen.subscriptions_failed", { error: subErr.message });
    throw new Error(`Failed to load subscriptions: ${subErr.message}`);
  }

  const activeSubscriptions = (subscriptions ?? []).filter(
    (s: { cap_voice_profiles?: unknown[] }) =>
      Array.isArray(s.cap_voice_profiles) && s.cap_voice_profiles.length > 0,
  );

  logger.info("cap.monthly-gen.start", {
    campaignMonth,
    subscriptionCount: activeSubscriptions.length,
  });

  let campaignsCreated = 0;
  let campaignsGenerated = 0;
  let failed = 0;

  for (const sub of activeSubscriptions as {
    id: string;
    cap_voice_profiles: { id: string; is_default: boolean }[];
  }[]) {
    try {
      const defaultProfile =
        sub.cap_voice_profiles.find((p) => p.is_default) ?? sub.cap_voice_profiles[0];

      // Upsert campaign for this month (UNIQUE on subscription + month)
      const { data: campaign, error: campaignErr } = await svc
        .from("cap_campaigns")
        .upsert(
          {
            cap_subscription_id: sub.id,
            voice_profile_id: defaultProfile.id,
            month: campaignMonth,
            monthly_objective: `Monthly LinkedIn content campaign for ${campaignMonth}`,
            status: "draft",
          },
          { onConflict: "cap_subscription_id,month", ignoreDuplicates: true },
        )
        .select("id, status")
        .maybeSingle();

      if (campaignErr) {
        logger.error("cap.monthly-gen.upsert_failed", {
          subscriptionId: sub.id,
          error: campaignErr.message,
        });
        failed++;
        continue;
      }

      // Get the actual campaign (may have been the ignored duplicate)
      const { data: existingCampaign } = await svc
        .from("cap_campaigns")
        .select("id, status")
        .eq("cap_subscription_id", sub.id)
        .eq("month", campaignMonth)
        .single();

      if (!existingCampaign) {
        failed++;
        continue;
      }

      if (campaign && campaign.id) {
        campaignsCreated++;
      }

      // Only run generation for draft campaigns (not already generating/review/etc.)
      if (existingCampaign.status === "draft") {
        await runCampaign(existingCampaign.id as string);
        campaignsGenerated++;
        logger.info("cap.monthly-gen.campaign_generated", {
          subscriptionId: sub.id,
          campaignId: existingCampaign.id,
        });
      }
    } catch (err) {
      logger.error("cap.monthly-gen.subscription_failed", {
        subscriptionId: sub.id,
        error: err instanceof Error ? err.message : String(err),
      });
      failed++;
    }
  }

  return {
    subscriptionsProcessed: activeSubscriptions.length,
    campaignsCreated,
    campaignsGenerated,
    failed,
  };
}
