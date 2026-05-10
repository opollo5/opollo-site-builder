"use client";

import { PLATFORM_LABEL } from "@/lib/platform/social/variants/types";
import type { AnalyticsDashboard } from "@/lib/platform/social/analytics-ingest";

import {
  formatAbsoluteTime,
  formatEngagementRate,
  formatNumber,
  formatRelativeTime,
} from "./format";
import { PLATFORM_COLOR, PLATFORM_INITIALS } from "./platform-theme";

export function TopPostsPanel({
  dashboard,
}: {
  dashboard: AnalyticsDashboard;
}) {
  if (dashboard.top_posts.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <div className="text-sm font-semibold">Top performing posts</div>
        <div className="mt-4 rounded-md border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          No posts in the selected window yet. Top posts will appear here
          once the daily analytics refresh has run at least once after a
          post is published.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm font-semibold">Top performing posts</div>
        <div className="text-xs text-muted-foreground">
          Sorted by engagement rate · top 10
        </div>
      </div>
      <ul
        className="divide-y"
        data-testid="top-posts-list"
      >
        {dashboard.top_posts.map((post) => (
          <li
            key={post.bundle_post_id}
            className="flex items-start gap-4 py-4 first:pt-0 last:pb-0"
            data-testid={`top-post-${post.bundle_post_id}`}
          >
            {post.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={post.thumbnail_url}
                alt=""
                className="h-16 w-16 flex-shrink-0 rounded-md object-cover"
              />
            ) : (
              <span
                className="inline-flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-md font-bold text-white"
                style={{ backgroundColor: PLATFORM_COLOR[post.platform] }}
                aria-hidden="true"
              >
                {PLATFORM_INITIALS[post.platform]}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  className="inline-flex h-4 w-4 items-center justify-center rounded text-xs font-bold text-white"
                  style={{ backgroundColor: PLATFORM_COLOR[post.platform] }}
                  aria-hidden="true"
                >
                  {PLATFORM_INITIALS[post.platform]}
                </span>
                <span>{PLATFORM_LABEL[post.platform]}</span>
                {post.posted_at && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span title={formatAbsoluteTime(post.posted_at)}>
                      {formatRelativeTime(post.posted_at)}
                    </span>
                  </>
                )}
              </div>
              <div className="mt-1 text-sm font-medium">
                {post.title ?? (
                  <span className="text-muted-foreground italic">
                    (no title)
                  </span>
                )}
              </div>
              {post.content_snippet && (
                <div className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                  {post.content_snippet}
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <Metric label="Impr." value={formatNumber(post.impressions)} />
                <Metric label="Likes" value={formatNumber(post.likes)} />
                <Metric label="Comm." value={formatNumber(post.comments)} />
                <Metric label="Shares" value={formatNumber(post.shares)} />
                <Metric
                  label="Eng. rate"
                  value={formatEngagementRate(post.engagement_rate)}
                  emphasis
                />
              </div>
            </div>
            {post.post_url && (
              <a
                href={post.post_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 self-center text-xs font-medium text-primary hover:underline"
              >
                View on platform →
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Metric({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={
          emphasis ? "font-semibold text-foreground" : "font-medium text-foreground"
        }
      >
        {value}
      </span>
    </span>
  );
}
