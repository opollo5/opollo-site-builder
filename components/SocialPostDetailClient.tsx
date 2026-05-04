"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  CommentDialog,
  ConfirmDialog,
} from "@/components/ui/confirm-dialog";
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
  canCreate: boolean;
  canRelease: boolean;
  canApprove: boolean;
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

type DialogKind =
  | "delete"
  | "submit"
  | "reopen"
  | "release"
  | "approve"
  | "cancel_approval"
  | "reject"
  | "request_changes"
  | null;

export function SocialPostDetailClient({ post, canEdit, canSubmit, canCreate, canRelease, canApprove }: Props) {
  const router = useRouter();
  const [masterText, setMasterText] = useState(post.master_text ?? "");
  const [linkUrl, setLinkUrl] = useState(post.link_url ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);

  const isDraft = post.state === "draft";
  const isPendingApproval = post.state === "pending_client_approval";
  const editable = canEdit && isDraft;
  const submittable = canSubmit && isDraft;
  const reopenable = canEdit && post.state === "changes_requested";
  const cancellable = canEdit && isPendingApproval;
  const releasable = canRelease && post.state === "pending_msp_release";
  const approvable = canApprove && isPendingApproval;

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
        setError(!json.ok ? json.error.message : "Failed to save post.");
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

  async function doDelete() {
    setBusy(true);
    setError(null);
    try {
      const url = `/api/platform/social/posts/${post.id}?company_id=${encodeURIComponent(post.company_id)}`;
      const res = await fetch(url, { method: "DELETE" });
      const json = (await res.json()) as
        | { ok: true; data: { deleted: true } }
        | { ok: false; error: { message: string } };
      if (!res.ok || !json.ok) {
        setError(!json.ok ? json.error.message : "Failed to delete post.");
        setBusy(false);
        return;
      }
      router.push("/company/social/posts");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function doSubmit() {
    setBusy(true);
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
        setError(!json.ok ? json.error.message : "Failed to submit for approval.");
        setBusy(false);
        return;
      }
      toast.success("Submitted for approval.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function doCancelApproval(reason: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/platform/social/posts/${post.id}/cancel-approval`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            company_id: post.company_id,
            reason: reason || null,
          }),
        },
      );
      const json = (await res.json()) as
        | { ok: true; data: { postState: "draft" } }
        | { ok: false; error: { message: string } };
      if (!res.ok || !json.ok) {
        setError(!json.ok ? json.error.message : "Failed to cancel approval.");
        setBusy(false);
        return;
      }
      toast.success("Approval cancelled — post returned to draft.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function doReopen() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/platform/social/posts/${post.id}/reopen`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ company_id: post.company_id }),
        },
      );
      const json = (await res.json()) as
        | { ok: true; data: { postState: "draft" } }
        | { ok: false; error: { message: string } };
      if (!res.ok || !json.ok) {
        setError(!json.ok ? json.error.message : "Failed to reopen post.");
        setBusy(false);
        return;
      }
      toast.success("Post reopened for editing.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function doRelease() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/platform/social/posts/${post.id}/release`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ company_id: post.company_id }),
        },
      );
      const json = (await res.json()) as
        | { ok: true; data: { postState: "approved" } }
        | { ok: false; error: { message: string } };
      if (!res.ok || !json.ok) {
        setError(!json.ok ? json.error.message : "Failed to release post.");
        setBusy(false);
        return;
      }
      toast.success("Post released — ready to schedule.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function doApprove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/platform/social/posts/${post.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: post.company_id }),
      });
      const json = (await res.json()) as
        | { ok: true; data: { postState: "approved" } }
        | { ok: false; error: { message: string } };
      if (!res.ok || !json.ok) {
        setError(!json.ok ? json.error.message : "Failed to approve post.");
        setBusy(false);
        return;
      }
      toast.success("Post approved.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function doReject(comment: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/platform/social/posts/${post.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: post.company_id, comment: comment || null }),
      });
      const json = (await res.json()) as
        | { ok: true; data: { postState: "rejected" } }
        | { ok: false; error: { message: string } };
      if (!res.ok || !json.ok) {
        setError(!json.ok ? json.error.message : "Failed to reject post.");
        setBusy(false);
        return;
      }
      toast.success("Post rejected.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function doRequestChanges(comment: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/platform/social/posts/${post.id}/request-changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: post.company_id, comment: comment || null }),
      });
      const json = (await res.json()) as
        | { ok: true; data: { postState: "changes_requested" } }
        | { ok: false; error: { message: string } };
      if (!res.ok || !json.ok) {
        setError(!json.ok ? json.error.message : "Failed to request changes.");
        setBusy(false);
        return;
      }
      toast.success("Changes requested.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function handleDuplicate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/platform/social/posts/${post.id}/duplicate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ company_id: post.company_id }),
        },
      );
      const json = (await res.json()) as
        | { ok: true; data: { newPostId: string } }
        | { ok: false; error: { message: string } };
      if (!res.ok || !json.ok) {
        setError(!json.ok ? json.error.message : "Failed to duplicate post.");
        setBusy(false);
        return;
      }
      toast.success("Post duplicated.");
      router.push(`/company/social/posts/${json.data.newPostId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <>
      {/* Confirm dialogs */}
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Delete post?"
        description="This draft will be permanently deleted. This cannot be undone."
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={doDelete}
      />
      <ConfirmDialog
        open={dialog === "submit"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Submit for approval?"
        description="You won't be able to edit this post until the reviewer responds."
        confirmLabel="Submit"
        onConfirm={doSubmit}
      />
      <ConfirmDialog
        open={dialog === "reopen"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Reopen for editing?"
        description="The reviewer's response stays in the audit trail. You'll need to re-submit after editing."
        confirmLabel="Reopen"
        onConfirm={doReopen}
      />
      <ConfirmDialog
        open={dialog === "release"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Release post?"
        description="The post will move to Approved and can then be scheduled for publishing."
        confirmLabel="Release"
        onConfirm={doRelease}
      />
      <ConfirmDialog
        open={dialog === "approve"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Approve post?"
        description="The post will move to Approved and can then be scheduled."
        confirmLabel="Approve"
        onConfirm={doApprove}
      />
      {/* Comment dialogs */}
      <CommentDialog
        open={dialog === "cancel_approval"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Cancel approval request?"
        description="The post will be returned to draft."
        commentLabel="Reason (optional)"
        commentPlaceholder="Why are you cancelling this request?"
        confirmLabel="Cancel approval"
        confirmVariant="destructive"
        onConfirm={doCancelApproval}
      />
      <CommentDialog
        open={dialog === "reject"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Reject post?"
        commentLabel="Note for the editor (optional)"
        confirmLabel="Reject"
        confirmVariant="destructive"
        onConfirm={doReject}
      />
      <CommentDialog
        open={dialog === "request_changes"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Request changes?"
        commentLabel="Note for the editor (optional)"
        confirmLabel="Request changes"
        onConfirm={doRequestChanges}
      />

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
                onClick={() => setDialog("submit")}
                disabled={busy}
                data-testid="submit-post-button"
              >
                Submit for approval
              </Button>
            ) : null}
            {reopenable ? (
              <Button
                onClick={() => setDialog("reopen")}
                disabled={busy}
                data-testid="reopen-post-button"
              >
                Reopen for editing
              </Button>
            ) : null}
            {releasable ? (
              <Button
                variant="outline"
                onClick={() => setDialog("release")}
                disabled={busy}
                data-testid="release-post-button"
              >
                Release
              </Button>
            ) : null}
            {approvable ? (
              <Button
                onClick={() => setDialog("approve")}
                disabled={busy}
                data-testid="approve-post-button"
              >
                Approve
              </Button>
            ) : null}
            {approvable ? (
              <Button
                variant="outline"
                onClick={() => setDialog("request_changes")}
                disabled={busy}
                data-testid="request-changes-button"
              >
                Request changes
              </Button>
            ) : null}
            {approvable ? (
              <Button
                variant="destructive"
                onClick={() => setDialog("reject")}
                disabled={busy}
                data-testid="reject-post-button"
              >
                Reject
              </Button>
            ) : null}
            {cancellable ? (
              <Button
                variant="ghost"
                onClick={() => setDialog("cancel_approval")}
                disabled={busy}
                data-testid="cancel-approval-button"
              >
                Cancel approval
              </Button>
            ) : null}
            {canCreate ? (
              <Button
                variant="outline"
                onClick={handleDuplicate}
                disabled={busy}
                data-testid="duplicate-post-button"
              >
                {busy ? "Duplicating…" : "Duplicate"}
              </Button>
            ) : null}
            {editable ? (
              <Button
                variant="destructive"
                onClick={() => setDialog("delete")}
                disabled={busy}
                data-testid="delete-post-button"
              >
                Delete
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

      {(post.state === "changes_requested" || post.state === "rejected") && post.reviewer_comment ? (
        <div
          className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
          role="note"
          data-testid="reviewer-comment-banner"
        >
          <p className="font-medium">
            {post.state === "rejected" ? "Rejection note" : "Reviewer note"}
          </p>
          <p className="mt-0.5 whitespace-pre-wrap">{post.reviewer_comment}</p>
        </div>
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
