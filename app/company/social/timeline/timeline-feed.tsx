import Link from "next/link";

import type { PostMasterListItem, SocialPostState } from "@/lib/platform/social/posts";

// ---------------------------------------------------------------------------
// Spec 22 PR 5 — TimelineFeed.
//
// Chronological list of social posts (newest first). Server component;
// data is fetched by the page RSC and passed in as props.
// ---------------------------------------------------------------------------

interface TimelineFeedProps {
  posts: PostMasterListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
}

const STATE_PILL: Record<SocialPostState, string> = {
  draft: "bg-muted text-muted-foreground",
  pending_client_approval: "bg-amber-100 text-amber-900",
  approved: "bg-emerald-100 text-emerald-900",
  rejected: "bg-rose-100 text-rose-900",
  changes_requested: "bg-amber-100 text-amber-900",
  scheduled: "bg-sky-100 text-sky-900",
  publishing: "bg-sky-200 text-sky-900",
  published: "bg-primary/10 text-primary",
  failed: "bg-rose-100 text-rose-900",
};

const STATE_LABEL: Record<SocialPostState, string> = {
  draft: "Draft",
  pending_client_approval: "Awaiting approval",
  approved: "Approved",
  rejected: "Rejected",
  changes_requested: "Changes requested",
  scheduled: "Scheduled",
  publishing: "Publishing",
  published: "Published",
  failed: "Failed",
};

export function TimelineFeed({ posts, totalCount, page, pageSize }: TimelineFeedProps) {
  const totalPages = Math.ceil(totalCount / pageSize);
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  if (posts.length === 0 && page === 1) {
    return (
      <div
        data-testid="timeline-empty"
        className="flex min-h-[24rem] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-gray-200 text-center"
      >
        <p className="text-sm font-medium text-tx-primary">No posts yet</p>
        <p className="max-w-xs text-sm text-tx-muted">
          Posts you create will appear here in chronological order.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="timeline-feed">
      <ol className="space-y-3">
        {posts.map((post) => (
          <li
            key={post.id}
            className="flex items-start gap-4 rounded-lg border border-white/10 bg-card p-4"
          >
            {/* Timestamp column */}
            <time
              dateTime={post.created_at}
              className="w-28 shrink-0 text-xs text-muted-foreground tabular-nums"
            >
              {new Date(post.created_at).toLocaleString("en-AU", {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>

            {/* Content */}
            <div className="min-w-0 flex-1">
              <p className="line-clamp-3 text-sm text-foreground">
                {post.master_text ?? (
                  <span className="italic text-muted-foreground">No text</span>
                )}
              </p>
              {post.link_url && (
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {post.link_url}
                </p>
              )}
            </div>

            {/* State pill */}
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATE_PILL[post.state]}`}
            >
              {STATE_LABEL[post.state]}
            </span>
          </li>
        ))}
      </ol>

      {/* Pagination */}
      {totalPages > 1 && (
        <nav
          aria-label="Timeline pagination"
          className="mt-6 flex items-center justify-between text-sm"
        >
          <span className="text-muted-foreground">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalCount)} of {totalCount}
          </span>
          <div className="flex gap-2">
            {hasPrev && (
              <Link
                href={`?page=${page - 1}`}
                className="rounded border border-white/10 px-3 py-1.5 hover:bg-white/5"
              >
                Previous
              </Link>
            )}
            {hasNext && (
              <Link
                href={`?page=${page + 1}`}
                className="rounded border border-white/10 px-3 py-1.5 hover:bg-white/5"
              >
                Next
              </Link>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
