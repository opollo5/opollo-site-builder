import { getServiceRoleClient } from "@/lib/supabase";

interface CompetitorPost {
  id: string;
  external_post_id: string;
  content: string | null;
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  posted_at: string | null;
  scraped_at: string;
}

async function fetchRecentPosts(companyId: string, limit = 20): Promise<CompetitorPost[]> {
  const svc = getServiceRoleClient();
  const { data } = await svc
    .from("ins_competitor_posts")
    .select("id, external_post_id, content, impressions, likes, comments, posted_at, scraped_at")
    .eq("company_id", companyId)
    .order("scraped_at", { ascending: false })
    .limit(limit);

  return (data ?? []) as CompetitorPost[];
}

export async function CompetitorHistory({ companyId }: { companyId: string }) {
  const posts = await fetchRecentPosts(companyId);

  if (posts.length === 0) {
    return (
      <div className="rounded-lg border border-b2 bg-b1 px-4 py-6 text-center">
        <p className="text-sm text-tx-muted">
          No scraped competitor posts yet. Data will appear after the next daily run.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-b2 bg-b1 overflow-hidden" data-testid="competitor-history">
      <div className="px-4 py-3 border-b border-b2">
        <h3 className="text-sm font-medium text-tx-primary">
          Recent competitor posts ({posts.length})
        </h3>
      </div>
      <ul className="divide-y divide-b2">
        {posts.map((post) => (
          <li key={post.id} className="px-4 py-3 space-y-1">
            <p className="text-sm text-tx-primary line-clamp-2">
              {post.content ?? <span className="text-tx-muted italic">No content captured</span>}
            </p>
            <div className="flex items-center gap-4 text-sm text-tx-muted">
              {post.posted_at && (
                <span>
                  Posted: {new Date(post.posted_at).toLocaleDateString()}
                </span>
              )}
              {post.likes != null && <span>{post.likes.toLocaleString()} likes</span>}
              {post.comments != null && <span>{post.comments.toLocaleString()} comments</span>}
              {post.impressions != null && (
                <span>{post.impressions.toLocaleString()} impressions</span>
              )}
              <span className="ml-auto">
                Scraped: {new Date(post.scraped_at).toLocaleDateString()}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
