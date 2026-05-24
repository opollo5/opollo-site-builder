import type { BestPost } from "@/lib/insights/dashboard";
import { PlatformBadge } from "./common/PlatformBadge";
import { SourceBadge } from "./common/SourceBadge";

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatNumber(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

interface PostRowProps {
  post: BestPost;
  availableMetrics: {
    likes: boolean;
    comments: boolean;
    shares: boolean;
    impressions: boolean;
  };
}

export function PostRow({ post, availableMetrics }: PostRowProps) {
  const metricParts: string[] = [];
  if (availableMetrics.impressions && post.impressions > 0) {
    metricParts.push(`${formatNumber(post.impressions)} impressions`);
  }
  if (availableMetrics.likes && post.likes !== null) {
    metricParts.push(`${post.likes} likes`);
  }
  if (availableMetrics.comments && post.comments !== null) {
    metricParts.push(`${post.comments} comments`);
  }
  if (availableMetrics.shares && post.shares !== null) {
    metricParts.push(`${post.shares} shares`);
  }

  return (
    <div className="border-l-2 border-pk py-2 pl-4" data-testid={`post-row-${post.bundlePostId}`}>
      <div className="mb-1 flex items-baseline justify-between">
        <div className="flex items-center gap-2 text-sm text-tx-muted">
          <PlatformBadge platform={post.platform} />
          <span>
            {formatDay(post.postedAt)} · {formatTime(post.postedAt)}
          </span>
          <SourceBadge source={post.source} />
        </div>
        <div className="text-lg font-semibold tabular-nums text-tx-primary">
          {(post.engagementRate * 100).toFixed(1)}%
        </div>
      </div>
      <p className="line-clamp-2 text-sm text-tx-secondary">{post.content}</p>
      {metricParts.length > 0 && (
        <div className="mt-1 text-sm text-tx-muted">
          {metricParts.join(" · ")}
        </div>
      )}
    </div>
  );
}
