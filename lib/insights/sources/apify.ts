import { ApifyClient } from "apify-client";

export interface ScrapeInput {
  platform: string;
  handle: string;
  companyId: string;
}

export interface ScrapeResult {
  ok: boolean;
  runId?: string;
  status?: string;
  reason?: string;
}

export interface ScrapedPost {
  externalPostId: string;
  content: string | null;
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  engagementRate: number | null;
  postedAt: string | null;
}

export interface ApifyAdapter {
  isConfigured(): boolean;
  scheduleScrape(input: ScrapeInput): Promise<ScrapeResult>;
  getResults(runId: string): Promise<ScrapedPost[]>;
}

const ACTOR_MAP: Record<string, string> = {
  LINKEDIN: process.env.APIFY_ACTOR_LINKEDIN ?? "anchor/linkedin-company-posts-scraper",
  FACEBOOK: process.env.APIFY_ACTOR_FACEBOOK ?? "apify/facebook-pages-scraper",
};

function buildPlatformUrl(platform: string, handle: string): string {
  if (platform === "LINKEDIN") {
    return `https://www.linkedin.com/company/${handle}/posts/`;
  }
  if (platform === "FACEBOOK") {
    return `https://www.facebook.com/${handle}`;
  }
  return handle;
}

function normalizeApifyItem(item: Record<string, unknown>): ScrapedPost {
  const externalPostId =
    (item.id as string) ??
    (item.postId as string) ??
    (item.url as string) ??
    String(Date.now());

  const text =
    (item.text as string) ??
    (item.commentary as string) ??
    (item.message as string) ??
    null;

  const impressions =
    typeof item.impressionsCount === "number"
      ? item.impressionsCount
      : typeof item.views === "number"
        ? item.views
        : null;

  const likes =
    typeof item.likesCount === "number"
      ? item.likesCount
      : typeof item.reactions === "number"
        ? item.reactions
        : null;

  const comments =
    typeof item.commentsCount === "number" ? item.commentsCount : null;

  const shares =
    typeof item.sharesCount === "number"
      ? item.sharesCount
      : typeof item.repostsCount === "number"
        ? item.repostsCount
        : null;

  const engagementRate =
    typeof item.engagementRate === "number" ? item.engagementRate : null;

  const postedAt =
    (item.postedAt as string) ??
    (item.timestamp as string) ??
    (item.createdAt as string) ??
    null;

  return {
    externalPostId,
    content: text,
    impressions,
    likes,
    comments,
    shares,
    engagementRate,
    postedAt,
  };
}

export function createApifyAdapter(): ApifyAdapter {
  const token = process.env.APIFY_TOKEN;

  return {
    isConfigured: () => Boolean(token),

    async scheduleScrape(input: ScrapeInput): Promise<ScrapeResult> {
      if (!token) {
        return { ok: false, reason: "apify_unconfigured" };
      }

      const actorId = ACTOR_MAP[input.platform];
      if (!actorId) return { ok: false, reason: "unsupported_platform" };

      const client = new ApifyClient({ token });

      const run = await client.actor(actorId).call({
        startUrls: [{ url: buildPlatformUrl(input.platform, input.handle) }],
        maxItems: 50,
      });

      return { ok: true, runId: run.id, status: run.status };
    },

    async getResults(runId: string): Promise<ScrapedPost[]> {
      if (!token) return [];
      const client = new ApifyClient({ token });
      const { items } = await client.run(runId).dataset().listItems();
      return (items as Record<string, unknown>[]).map(normalizeApifyItem);
    },
  };
}
