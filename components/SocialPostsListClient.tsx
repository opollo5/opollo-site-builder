"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { BulkUploadButton } from "@/components/BulkUploadButton";
import { Button } from "@/components/ui/button";
import { H1, Lead } from "@/components/ui/typography";
import type {
  PostMasterListItem,
  SocialPostSource,
  SocialPostState,
} from "@/lib/platform/social/posts";

// ---------------------------------------------------------------------------
// S1-2 — client shell for /company/social/posts.
//
// Renders a state-filterable list of social posts. The "New post"
// button wires straight to POST /api/platform/social/posts and
// reloads on success. V1 keeps the create form inline + minimal
// (master_text + link_url); a richer modal lands when variant /
// scheduling slices arrive and the form needs more inputs.
//
// S1-37 — adds server-side text search via ?q= param.
// S1-38 — adds ?page=N URL pagination (25 per page, prev/next links).
// S1-40 — state-filter tabs are now URL-driven via ?state=. Dashboard
//          tiles that link to ?state=approved etc. now pre-select the
//          correct tab and the server applies the filter server-side.
// S1-43 — source badge (CSV / CAP / API) shown under the copy text
//          for non-manual posts; manual posts show no badge.
// ---------------------------------------------------------------------------

type FilterKey = "all" | SocialPostState;

type Props = {
  companyId: string;
  initialPosts: PostMasterListItem[];
  canCreate: boolean;
  initialQ?: string;
  initialState?: FilterKey;
  page?: number;
  pageSize?: number;
  totalCount?: number;
};

const STATE_PILL: Record<SocialPostState, string> = {
  draft: "bg-muted text-muted-foreground",
  pending_client_approval: "bg-amber-100 text-amber-900",
  approved: "bg-emerald-100 text-emerald-900",
  rejected: "bg-rose-100 text-rose-900",
  changes_requested: "bg-amber-100 text-amber-900",
  pending_msp_release: "bg-sky-100 text-sky-900",
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
  pending_msp_release: "Awaiting MSP release",
  scheduled: "Scheduled",
  publishing: "Publishing",
  published: "Published",
  failed: "Failed",
};

const FILTER_TABS: Array<{ key: "all" | SocialPostState; label: string }> = [
  { key: "all", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "pending_client_approval", label: "Awaiting approval" },
  { key: "changes_requested", label: "Changes requested" },
  { key: "approved", label: "Approved" },
  { key: "scheduled", label: "Scheduled" },
  { key: "published", label: "Published" },
  { key: "failed", label: "Failed" },
  { key: "rejected", label: "Rejected" },
];

const SOURCE_LABEL: Partial<Record<SocialPostSource, string>> = {
  csv: "CSV",
  cap: "CAP",
  api: "API",
};

const SOURCE_PILL: Partial<Record<SocialPostSource, string>> = {
  csv: "bg-violet-100 text-violet-900",
  cap: "bg-teal-100 text-teal-900",
  api: "bg-slate-100 text-slate-700",
};

function buildUrl({
  page,
  q,
  state,
}: {
  page: number;
  q: string;
  state: FilterKey;
}): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (state !== "all") params.set("state", state);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return `/company/social/posts${qs ? `?${qs}` : ""}`;
}

export function SocialPostsListClient({
  companyId,
  initialPosts,
  canCreate,
  initialQ = "",
  initialState = "all",
  page = 1,
  pageSize = 25,
  totalCount,
}: Props) {
  const router = useRouter();
  const [posts, setPosts] = useState(initialPosts);
  const [filter, setFilter] = useState<FilterKey>(initialState);
  const [showCreate, setShowCreate] = useState(false);
  const [masterText, setMasterText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(initialQ);
  const searchRef = useRef<HTMLInputElement>(null);

  const total = totalCount ?? posts.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  // State filter is now server-side: posts already contains only the
  // rows matching the active state tab. `visible` is identical to `posts`.
  // The memo is kept so existing data-testid consumers still work.
  const visible = useMemo(() => posts, [posts]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const term = searchInput.trim();
    router.push(buildUrl({ page: 1, q: term, state: filter }));
  }

  function clearSearch() {
    setSearchInput("");
    router.push(buildUrl({ page: 1, q: "", state: filter }));
  }

  function handleTabClick(key: FilterKey) {
    setFilter(key);
    router.push(buildUrl({ page: 1, q: searchInput.trim(), state: key }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/platform/social/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: companyId,
          master_text: masterText.trim() || undefined,
          link_url: linkUrl.trim() || undefined,
        }),
      });
      const json = (await res.json()) as
        | { ok: true; data: { post: PostMasterListItem } }
        | { ok: false; error: { message: string } };
      if (!res.ok || !json.ok) {
        const msg = !json.ok ? json.error.message : "Failed to create post.";
        setError(msg);
        return;
      }
      setPosts((prev) => [json.data.post, ...prev]);
      setMasterText("");
      setLinkUrl("");
      setShowCreate(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const countLabel = initialQ
    ? `${total} ${total === 1 ? "result" : "results"} for "${initialQ}"`
    : total === 0
      ? "No posts yet."
      : totalPages > 1
        ? `${from}–${to} of ${total} posts`
        : `${total} ${total === 1 ? "post" : "posts"}`;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <H1>Social posts</H1>
          <Lead className="mt-0.5">{countLabel}</Lead>
        </div>
        {canCreate ? (
          <div className="flex items-center gap-2">
            <BulkUploadButton
              companyId={companyId}
              onSuccess={(newPosts) =>
                setPosts((prev) => [...newPosts, ...prev])
              }
            />
            <Button
              data-testid="new-post-button"
              onClick={() => setShowCreate((v) => !v)}
            >
              {showCreate ? "Cancel" : "New post"}
            </Button>
          </div>
        ) : null}
      </div>

      {/* Search bar */}
      <form
        onSubmit={handleSearch}
        className="mt-4 flex items-center gap-2"
        role="search"
        aria-label="Search posts"
      >
        <input
          ref={searchRef}
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search post copy…"
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          data-testid="posts-search-input"
        />
        <Button type="submit" variant="outline" data-testid="posts-search-submit">
          Search
        </Button>
        {initialQ ? (
          <Button
            type="button"
            variant="ghost"
            onClick={clearSearch}
            data-testid="posts-search-clear"
          >
            Clear
          </Button>
        ) : null}
      </form>

      {showCreate && canCreate ? (
        <form
          onSubmit={handleCreate}
          className="mt-4 rounded-lg border bg-card p-4"
          data-testid="new-post-form"
        >
          <label className="block text-sm font-medium" htmlFor="master_text">
            Post copy
          </label>
          <textarea
            id="master_text"
            className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
            rows={4}
            placeholder="What do you want to post?"
            value={masterText}
            onChange={(e) => setMasterText(e.target.value)}
            data-testid="new-post-master-text"
          />
          <label
            className="mt-3 block text-sm font-medium"
            htmlFor="link_url"
          >
            Link URL (optional)
          </label>
          <input
            id="link_url"
            type="url"
            className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
            placeholder="https://example.com/article"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            data-testid="new-post-link-url"
          />
          {error ? (
            <p
              className="mt-3 text-sm text-destructive"
              role="alert"
              data-testid="new-post-error"
            >
              {error}
            </p>
          ) : null}
          <div className="mt-4 flex items-center gap-2">
            <Button type="submit" disabled={submitting} data-testid="new-post-submit">
              {submitting ? "Saving…" : "Save draft"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setShowCreate(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      <nav
        className="mt-6 flex flex-wrap gap-2"
        aria-label="Filter posts by state"
      >
        {FILTER_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => handleTabClick(t.key)}
            className={`rounded-full border px-3 py-1 text-sm transition ${
              filter === t.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-muted-foreground/20 hover:bg-muted/40"
            }`}
            data-testid={`posts-filter-${t.key}`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div
        className="mt-4 overflow-hidden rounded-lg border bg-card"
        data-testid="social-posts-table"
      >
        {visible.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {initialQ
              ? `No posts found matching "${initialQ}"${initialState !== "all" ? ` in this filter` : ""}.`
              : initialState !== "all"
                ? "No posts match this filter."
                : "No posts yet — click New post to draft your first one."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-left text-sm uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Copy</th>
                <th className="px-4 py-2 font-medium">Link</th>
                <th className="px-4 py-2 font-medium">State</th>
                <th className="px-4 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr
                  key={p.id}
                  className="border-b last:border-b-0 hover:bg-muted/20"
                  data-testid={`social-post-row-${p.id}`}
                >
                  <td className="max-w-md px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <Link
                        href={`/company/social/posts/${p.id}`}
                        className="truncate hover:underline"
                        data-testid={`social-post-link-${p.id}`}
                      >
                        {p.master_text ?? (
                          <span className="text-muted-foreground">— No copy —</span>
                        )}
                      </Link>
                      {SOURCE_LABEL[p.source_type] ? (
                        <span
                          className={`inline-block w-fit rounded px-1.5 py-0.5 text-xs font-medium ${SOURCE_PILL[p.source_type]}`}
                          data-testid={`social-post-source-${p.id}`}
                        >
                          {SOURCE_LABEL[p.source_type]}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="max-w-xs truncate px-4 py-3 text-sm text-muted-foreground">
                    {p.link_url ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-sm font-medium ${STATE_PILL[p.state]}`}
                    >
                      {STATE_LABEL[p.state]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                    {new Date(p.state_changed_at).toLocaleString("en-AU", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 ? (
        <div
          className="mt-4 flex items-center justify-between text-sm text-muted-foreground"
          data-testid="posts-pagination"
        >
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {hasPrev ? (
              <Link
                href={buildUrl({ page: page - 1, q: initialQ, state: filter })}
                className="rounded-md border px-3 py-1 hover:bg-muted/40 transition"
                data-testid="posts-pagination-prev"
              >
                ← Previous
              </Link>
            ) : null}
            {hasNext ? (
              <Link
                href={buildUrl({ page: page + 1, q: initialQ, state: filter })}
                className="rounded-md border px-3 py-1 hover:bg-muted/40 transition"
                data-testid="posts-pagination-next"
              >
                Next →
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
