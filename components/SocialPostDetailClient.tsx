"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { H1, Lead } from "@/components/ui/typography";
import type {
  PostMaster,
  SocialPostState,
} from "@/lib/platform/social/posts";

// ---------------------------------------------------------------------------
// S1-3 — detail + edit + delete shell.
//
// V1 only allows edit/delete while state='draft'. The button row reflects
// that — non-drafts get a read-only badge + a "Back to list" link, no
// edit / delete affordances. The lib + route both enforce the state
// guard in case someone hand-crafts a request, so the UI gating is
// purely UX clarity.
// ---------------------------------------------------------------------------

type Props = {
  post: PostMaster;
  canEdit: boolean;
  canSubmit: boolean;
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

export function SocialPostDetailClient({ post, canEdit, canSubmit }: Props) {
  const router = useRouter();
  const [masterText, setMasterText] = useState(post.master_text ?? "");
  const [linkUrl, setLinkUrl] = useState(post.link_url ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDraft = post.state === "draft";
  const editable = canEdit && isDraft;
  const submittable = canSubmit && isDraft;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/platform/social/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: post.company_id,
          master_text: masterText.trim() || null,
          link_url: linkUrl.trim() || null,
        }),
      });
      const json = (await res.json()) as
        | { ok: true; data: { post: PostMaster } }
        | { ok: false; error: { message: string } };
      if (!res.ok || !json.ok) {
        const msg = !json.ok ? json.error.message : "Failed to save post.";
        setError(msg);
        return;
      }
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this draft post? This cannot be undone.")) return;
    setDeleting(true);
    setError(null);
    try {
      const url = `/api/platform/social/posts/${post.id}?company_id=${encodeURIComponent(post.company_id)}`;
      const res = await fetch(url, { method: "DELETE" });
      const json = (await res.json()) as
        | { ok: true; data: { deleted: true } }
        | { ok: false; error: { message: string } };
      if (!res.ok || !json.ok) {
        const msg = !json.ok ? json.error.message : "Failed to delete post.";
        setError(msg);
        setDeleting(false);
        return;
      }
      router.push("/company/social/posts");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  async function handleSubmitForApproval() {
    if (
      !confirm(
        "Submit this post for approval? You won't be able to edit it again until the reviewer responds.",
      )
    ) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/platform/social/posts/${post.id}/submit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ company_id: post.company_id }),
        },
      );
      const json = (await res.json()) as
        | { ok: true; data: { approvalRequestId: string } }
        | { ok: false; error: { message: string } };
      if (!res.ok || !json.ok) {
        const msg = !json.ok
          ? json.error.message
          : "Failed to submit for approval.";
        setError(msg);
        setSubmitting(false);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link
            href="/company/social/posts"
            className="text-sm text-muted-foreground hover:underline"
          >
            ← Back to posts
          </Link>
          <H1 className="mt-2">Post detail</H1>
          <Lead className="mt-0.5">
            <span
              className="inline-block rounded-full bg-muted px-2 py-0.5 text-sm font-medium"
              data-testid="post-state-badge"
            >
              {STATE_LABEL[post.state]}
            </span>
          </Lead>
        </div>
        {!editing ? (
          <div className="flex flex-wrap gap-2">
            {editable ? (
              <Button
                onClick={() => setEditing(true)}
                data-testid="edit-post-button"
              >
                Edit
              </Button>
            ) : null}
            {submittable ? (
              <Button
                onClick={handleSubmitForApproval}
                disabled={submitting}
                data-testid="submit-post-button"
              >
                {submitting ? "Submitting…" : "Submit for approval"}
              </Button>
            ) : null}
            {editable ? (
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
                data-testid="delete-post-button"
              >
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? (
        <p
          className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
          data-testid="post-detail-error"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-6 rounded-lg border bg-card p-4">
        {editing ? (
          <form onSubmit={handleSave} data-testid="edit-post-form">
            <label
              className="block text-sm font-medium"
              htmlFor="edit_master_text"
            >
              Post copy
            </label>
            <textarea
              id="edit_master_text"
              className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
              rows={6}
              value={masterText}
              onChange={(e) => setMasterText(e.target.value)}
              data-testid="edit-post-master-text"
            />
            <label
              className="mt-3 block text-sm font-medium"
              htmlFor="edit_link_url"
            >
              Link URL
            </label>
            <input
              id="edit_link_url"
              type="url"
              className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              data-testid="edit-post-link-url"
            />
            <div className="mt-4 flex gap-2">
              <Button
                type="submit"
                disabled={saving}
                data-testid="edit-post-submit"
              >
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setMasterText(post.master_text ?? "");
                  setLinkUrl(post.link_url ?? "");
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <ReadOnlyView post={post} />
        )}
      </div>
    </>
  );
}

function ReadOnlyView({ post }: { post: PostMaster }) {
  return (
    <dl className="space-y-4 text-sm">
      <div>
        <dt className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Copy
        </dt>
        <dd
          className="mt-1 whitespace-pre-wrap"
          data-testid="post-master-text"
        >
          {post.master_text ?? (
            <span className="text-muted-foreground">— No copy —</span>
          )}
        </dd>
      </div>
      <div>
        <dt className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Link
        </dt>
        <dd className="mt-1" data-testid="post-link-url">
          {post.link_url ? (
            <a
              href={post.link_url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary hover:underline"
            >
              {post.link_url}
            </a>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </dd>
      </div>
      <div className="grid gap-4 text-sm text-muted-foreground sm:grid-cols-3">
        <div>
          <dt className="font-medium uppercase tracking-wide">Created</dt>
          <dd className="mt-1 tabular-nums">
            {new Date(post.created_at).toLocaleString("en-AU")}
          </dd>
        </div>
        <div>
          <dt className="font-medium uppercase tracking-wide">Last change</dt>
          <dd className="mt-1 tabular-nums">
            {new Date(post.state_changed_at).toLocaleString("en-AU")}
          </dd>
        </div>
        <div>
          <dt className="font-medium uppercase tracking-wide">Source</dt>
          <dd className="mt-1 capitalize">{post.source_type}</dd>
        </div>
      </div>
    </dl>
  );
}
