"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { H1, Lead } from "@/components/ui/typography";
import type {
  PostMasterListItem,
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
// ---------------------------------------------------------------------------

type Props = {
  companyId: string;
  initialPosts: PostMasterListItem[];
  canCreate: boolean;
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
  { key: "approved", label: "Approved" },
  { key: "scheduled", label: "Scheduled" },
  { key: "published", label: "Published" },
];

export function SocialPostsListClient({
  companyId,
  initialPosts,
  canCreate,
}: Props) {
  const [posts, setPosts] = useState(initialPosts);
  const [filter, setFilter] = useState<(typeof FILTER_TABS)[number]["key"]>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [masterText, setMasterText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(
    () => (filter === "all" ? posts : posts.filter((p) => p.state === filter)),
    [posts, filter],
  );

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

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <H1>Social posts</H1>
          <Lead className="mt-0.5">
            {posts.length === 0
              ? "No posts yet."
              : `${posts.length} ${posts.length === 1 ? "post" : "posts"}.`}
          </Lead>
        </div>
        {canCreate ? (
          <Button
            data-testid="new-post-button"
            onClick={() => setShowCreate((v) => !v)}
          >
            {showCreate ? "Cancel" : "New post"}
          </Button>
        ) : null}
      </div>

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
            onClick={() => setFilter(t.key)}
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
            {posts.length === 0
              ? "No posts yet — click New post to draft your first one."
              : "No posts match this filter."}
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
                  <td className="max-w-md truncate px-4 py-3">
                    {p.master_text ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="max-w-xs truncate px-4 py-3 text-sm text-muted-foreground">
                    {p.link_url ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_PILL[p.state]}`}
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
    </>
  );
}
