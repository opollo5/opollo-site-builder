"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toastSuccess } from "@/lib/toast-success";

import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  CommentDialog,
} from "@/components/ui/confirm-dialog";
import { Lead } from "@/components/ui/typography";
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
  canApprove: boolean;
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

type DialogState =
  | { type: "none" }
  | {
      type: "confirm";
      title: string;
      description?: string;
      confirmLabel?: string;
      confirmVariant?: "default" | "destructive" | "outline" | "ghost";
      onConfirm: () => void;
    }
  | {
      type: "comment";
      title: string;
      description?: string;
      commentLabel?: string;
      confirmLabel?: string;
      confirmVariant?: "default" | "destructive" | "outline" | "ghost";
      onConfirm: (comment: string) => void;
    };

export function SocialPostDetailClient({ post, canEdit, canSubmit, canCreate, canApprove }: Props) {
  const router = useRouter();
  const [masterText, setMasterText] = useState(post.master_text ?? "");
  const [linkUrl, setLinkUrl] = useState(post.link_url ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ type: "none" });

  const isDraft = post.state === "draft";
  const isPendingApproval = post.state === "pending_client_approval";
  const editable = canEdit && isDraft;
  const submittable = canSubmit && isDraft;
  const reopenable = canEdit && post.state === "changes_requested";
  const cancellable = canEdit && isPendingApproval;
  const approvable = canApprove && isPendingApproval;
  const [cancelling, setCancelling] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [requestingChanges, setRequestingChanges] = useState(false);

  function closeDialog() {
    setDialog({ type: "none" });
  }

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

  function handleDelete() {
    setDialog({
      type: "confirm",
      title: "Delete this draft post?",
      description: "This cannot be undone.",
      confirmLabel: "Delete",
      confirmVariant: "destructive",
      onConfirm: executeDelete,
    });
  }

  async function executeDelete() {
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

  function handleSubmitForApproval() {
    setDialog({
      type: "confirm",
      title: "Submit for approval?",
      description:
        "You won't be able to edit this post again until the reviewer responds.",
      confirmLabel: "Submit",
      onConfirm: executeSubmitForApproval,
    });
  }

  async function executeSubmitForApproval() {
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
      toastSuccess("Submitted for approval.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  function handleCancelApproval() {
    setDialog({
      type: "comment",
      title: "Cancel approval request?",
      description:
        "The post will return to draft. An optional reason is recorded in the audit log.",
      confirmLabel: "Cancel approval",
      onConfirm: executeCancelApproval,
    });
  }

  async function executeCancelApproval(reason: string) {
    setCancelling(true);
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
        const msg = !json.ok
          ? json.error.message
          : "Failed to cancel approval.";
        setError(msg);
        setCancelling(false);
        return;
      }
      toastSuccess("Approval cancelled — post returned to draft.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCancelling(false);
    }
  }

  function handleReopen() {
    setDialog({
      type: "confirm",
      title: "Reopen for editing?",
      description:
        "The reviewer's response will stay in the audit trail. You'll need to re-submit for approval after editing.",
      confirmLabel: "Reopen",
      onConfirm: executeReopen,
    });
  }

  async function executeReopen() {
    setReopening(true);
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
        const msg = !json.ok ? json.error.message : "Failed to reopen post.";
        setError(msg);
        setReopening(false);
        return;
      }
      toastSuccess("Post reopened for editing.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setReopening(false);
    }
  }

  function handleApprove() {
    setDialog({
      type: "confirm",
      title: "Approve this post?",
      description: "It will move to Approved and can then be scheduled.",
      confirmLabel: "Approve",
      onConfirm: executeApprove,
    });
  }

  async function executeApprove() {
    setApproving(true);
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
        setApproving(false);
        return;
      }
      toastSuccess("Post approved.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setApproving(false);
    }
  }

  function handleReject() {
    setDialog({
      type: "comment",
      title: "Reject this post?",
      description: "An optional note is sent to the editor.",
      commentLabel: "Note for editor (optional)",
      confirmLabel: "Reject",
      confirmVariant: "destructive",
      onConfirm: executeReject,
    });
  }

  async function executeReject(comment: string) {
    setRejecting(true);
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
        setRejecting(false);
        return;
      }
      toastSuccess("Post rejected.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRejecting(false);
    }
  }

  function handleRequestChanges() {
    setDialog({
      type: "comment",
      title: "Request changes?",
      description: "An optional note is sent to the editor.",
      commentLabel: "Note for editor (optional)",
      confirmLabel: "Request changes",
      onConfirm: executeRequestChanges,
    });
  }

  async function executeRequestChanges(comment: string) {
    setRequestingChanges(true);
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
        setRequestingChanges(false);
        return;
      }
      toastSuccess("Changes requested.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRequestingChanges(false);
    }
  }

  async function handleDuplicate() {
    setDuplicating(true);
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
        setDuplicating(false);
        return;
      }
      toastSuccess("Post duplicated.");
      router.push(`/company/social/posts/${json.data.newPostId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDuplicating(false);
    }
  }

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
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
            {reopenable ? (
              <Button
                onClick={handleReopen}
                disabled={reopening}
                data-testid="reopen-post-button"
              >
                {reopening ? "Reopening…" : "Reopen for editing"}
              </Button>
            ) : null}
            {approvable ? (
              <Button
                onClick={handleApprove}
                disabled={approving}
                data-testid="approve-post-button"
              >
                {approving ? "Approving…" : "Approve"}
              </Button>
            ) : null}
            {approvable ? (
              <Button
                variant="outline"
                onClick={handleRequestChanges}
                disabled={requestingChanges}
                data-testid="request-changes-button"
              >
                {requestingChanges ? "Requesting…" : "Request changes"}
              </Button>
            ) : null}
            {approvable ? (
              <Button
                variant="destructive"
                onClick={handleReject}
                disabled={rejecting}
                data-testid="reject-post-button"
              >
                {rejecting ? "Rejecting…" : "Reject"}
              </Button>
            ) : null}
            {cancellable ? (
              <Button
                variant="ghost"
                onClick={handleCancelApproval}
                disabled={cancelling}
                data-testid="cancel-approval-button"
              >
                {cancelling ? "Cancelling…" : "Cancel approval"}
              </Button>
            ) : null}
            {canCreate ? (
              <Button
                variant="outline"
                onClick={handleDuplicate}
                disabled={duplicating}
                data-testid="duplicate-post-button"
              >
                {duplicating ? "Duplicating…" : "Duplicate"}
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

      {(post.state === "changes_requested" || post.state === "rejected") && post.reviewer_comment ? (
        <div
          className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
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

      {dialog.type === "confirm" && (
        <ConfirmDialog
          open
          onOpenChange={(open) => { if (!open) closeDialog(); }}
          title={dialog.title}
          description={dialog.description}
          confirmLabel={dialog.confirmLabel}
          confirmVariant={dialog.confirmVariant}
          onConfirm={dialog.onConfirm}
        />
      )}
      {dialog.type === "comment" && (
        <CommentDialog
          open
          onOpenChange={(open) => { if (!open) closeDialog(); }}
          title={dialog.title}
          description={dialog.description}
          commentLabel={dialog.commentLabel}
          confirmLabel={dialog.confirmLabel}
          confirmVariant={dialog.confirmVariant}
          onConfirm={dialog.onConfirm}
        />
      )}
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
