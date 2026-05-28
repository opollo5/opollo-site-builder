import "server-only";

import { withHealthMonitoring } from "@/lib/platform/service-health/monitor";

const SERVICE = "bundle.social";

interface PublishPostParams {
  externalPostId: string;
  content: string;
  mediaUrls?: string[];
  targetProfileIds: string[];
  scheduledAt?: string;
  platformVariants?: Record<string, { content?: string; link?: string; cta?: string }>;
}

interface PublishPostResult {
  externalId: string;
  publishedUrl?: string;
}

interface AnalyticsResult {
  impressions: number | null;
  engagement_rate: number | null;
  reactions: number | null;
  shares: number | null;
  comments: number | null;
  clicks: number | null;
  platform_specific: Record<string, number | string>;
  fetched_at: string;
}

function getApiKey(): string {
  const key = process.env.BUNDLE_SOCIAL_API;
  if (!key) throw new Error("BUNDLE_SOCIAL_API is not configured.");
  return key;
}

function bundleSocialHeaders(): Record<string, string> {
  return { "Authorization": `Bearer ${getApiKey()}`, "Content-Type": "application/json" };
}

export async function publishPost(params: PublishPostParams): Promise<PublishPostResult> {
  return withHealthMonitoring(SERVICE, "publish", async () => {
    const resp = await fetch("https://app.bundle.social/api/v1/posts", {
      method: "POST",
      headers: bundleSocialHeaders(),
      body: JSON.stringify({
        external_id: params.externalPostId,
        content: params.content,
        media_urls: params.mediaUrls ?? [],
        profile_ids: params.targetProfileIds,
        scheduled_at: params.scheduledAt,
        platform_variants: params.platformVariants ?? {},
      }),
    });
    if (!resp.ok) {
      const err = Object.assign(new Error(`bundle.social publish failed: ${resp.status}`), { status: resp.status });
      throw err;
    }
    const data = (await resp.json()) as { id: string; url?: string };
    return { externalId: data.id, publishedUrl: data.url };
  });
}

export async function fetchAnalytics(externalPostId: string): Promise<AnalyticsResult> {
  return withHealthMonitoring(SERVICE, "analytics", async () => {
    const resp = await fetch(`https://app.bundle.social/api/v1/posts/${externalPostId}/analytics`, {
      headers: bundleSocialHeaders(),
    });
    if (!resp.ok) {
      const err = Object.assign(new Error(`bundle.social analytics failed: ${resp.status}`), { status: resp.status });
      throw err;
    }
    const data = (await resp.json()) as Partial<AnalyticsResult>;
    return {
      impressions: data.impressions ?? null,
      engagement_rate: data.engagement_rate ?? null,
      reactions: data.reactions ?? null,
      shares: data.shares ?? null,
      comments: data.comments ?? null,
      clicks: data.clicks ?? null,
      platform_specific: data.platform_specific ?? {},
      fetched_at: new Date().toISOString(),
    };
  });
}
