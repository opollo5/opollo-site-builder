"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { StatusPill, postStatusKind } from "@/components/ui/status-pill";
import type { PostDetail } from "@/lib/posts";
import type { PreflightResult } from "@/lib/site-preflight";

// ---------------------------------------------------------------------------
// M13-4 — post detail + publish/unpublish controls.
//
// Renders:
//   - Title + slug + status pill + WP post id
//   - Preflight blocker (translated) when preflight failed
//   - Rendered HTML preview in <iframe sandbox="">
//   - Publish button (disabled when preflight blocks OR post has no
//     generated_html)
//   - Unpublish button (only when status='published'), behind a
//     confirm modal naming the WP URL that will be trashed
//   - Inline error surface for API failures
//
// Assistive-operator-flow contract: every destructive action goes
// through a confirm modal that names the exact consequence. Publish
// is NOT gated behind a modal because it's additive (trashable via WP
// if the operator changes their mind). Unpublish IS gated because
// while WP's trash is recoverable, the operator seeing a modal before
// the trash action keeps the "visible-to-readers → not-visible"
// transition explicit.
// ---------------------------------------------------------------------------

type ActionState = "idle" | "publishing" | "unpublishing";

export function PostDetailClient({
  siteId,
  siteWpUrl,
  post,
  preflight,
}: {
  siteId: string;
  siteWpUrl: string;
  post: PostDetail;
  preflight: PreflightResult;
}) {
  const router = useRouter();
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [unpublishOpen, setUnpublishOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);

  const preflightBlocked = preflight.ok === false;
  const canPublish =
    !preflightBlocked &&
    post.generated_html !== null &&
    post.generated_html.trim() !== "" &&
    post.status !== "published";

  const canUnpublish = post.status === "published" && post.wp_post_id !== null;

  const wpFrontendUrl = post.wp_post_id
    ? `${siteWpUrl.replace(/\/+$/, "")}/?p=${post.wp_post_id}`
    : null;

  async function handlePublish() {
    setActionState("publishing");
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/sites/${siteId}/posts/${post.id}/publish`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expected_version_lock: post.version_lock }),
        },
      );
      const payload = (await res.json()) as {
        ok: boolean;
        error?: {
          code: string;
          message: string;
          details?: { blocker?: { detail?: string }; translated?: { detail?: string } };
        };
      };
      if (res.ok && payload.ok) {
        setPublishOpen(false);
        router.refresh();
        return;
      }
      const translatedDetail =
        payload.error?.details?.translated?.detail ??
        payload.error?.details?.blocker?.detail ??
        payload.error?.message ??
        `Publish failed (HTTP ${res.status}).`;
      setErrorMessage(translatedDetail);
    } catch (err) {
      setErrorMessage(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setActionState("idle");
    }
  }

  async function handleUnpublish() {
    setActionState("unpublishing");
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/sites/${siteId}/posts/${post.id}/unpublish`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expected_version_lock: post.version_lock }),
        },
      );
      const payload = (await res.json()) as {
        ok: boolean;
        error?: { code: string; message: string };
      };
      if (res.ok && payload.ok) {
        setUnpublishOpen(false);
        router.refresh();
        return;
      }
      setErrorMessage(
        payload.error?.message ?? `Unpublish failed (HTTP ${res.status}).`,
      );
    } catch (err) {
      setErrorMessage(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setActionState("idle");
    }
  }

  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{post.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <code className="text-xs">/{post.slug}</code>
            {" · "}
            <StatusPill kind={postStatusKind(post.status)} className="capitalize" />
            {post.wp_post_id && (
              <>
                {" · "}
                <span className="text-xs">WP id {post.wp_post_id}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canPublish && (
            <Button
              type="button"
              onClick={() => setPublishOpen(true)}
              disabled={actionState !== "idle"}
            >
              {post.wp_post_id ? "Re-publish to WP" : "Publish to WP"}
            </Button>
          )}
          {canUnpublish && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setUnpublishOpen(true)}
              disabled={actionState !== "idle"}
            >
              Unpublish (send to WP trash)
            </Button>
          )}
        </div>
      </div>

      {preflightBlocked && (
        <div
          role="alert"
          className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-yellow-900 dark:text-yellow-200"
        >
          <p className="font-medium">
            {"blocker" in preflight ? preflight.blocker.title : "Preflight failed."}
          </p>
          {"blocker" in preflight && (
            <>
              <p className="mt-1">{preflight.blocker.detail}</p>
              <p className="mt-2 text-xs">
                <strong>What to do:</strong> {preflight.blocker.nextAction}
              </p>
            </>
          )}
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {errorMessage}
        </div>
      )}

      <section
        aria-labelledby="preview-heading"
        className="rounded-lg border p-4"
      >
        <h2 id="preview-heading" className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Generated HTML
        </h2>
        {post.generated_html ? (
          <iframe
            sandbox=""
            srcDoc={post.generated_html}
            className="mt-3 h-96 w-full rounded border"
            title={`Preview of ${post.title}`}
          />
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No generated HTML yet. The post will populate when the brief runner
            lands a draft for this page and the operator approves it.
          </p>
        )}
      </section>

      {post.excerpt && (
        <section className="rounded-lg border p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Excerpt
          </h2>
          <p className="mt-2 text-sm">{post.excerpt}</p>
        </section>
      )}

      {wpFrontendUrl && post.status === "published" && (
        <p className="text-xs text-muted-foreground">
          Live on WordPress:{" "}
          <a
            href={wpFrontendUrl}
            target="_blank"
            rel="noreferrer"
            className="underline hover:no-underline"
          >
            {wpFrontendUrl}
          </a>
        </p>
      )}

      {publishOpen && (
        <ConfirmModal
          title={post.wp_post_id ? "Re-publish to WordPress?" : "Publish to WordPress?"}
          body={
            post.wp_post_id
              ? `This overwrites the live WP post at ${wpFrontendUrl ?? "the same URL"} with the current Opollo draft. WP keeps the previous version as a revision; nothing is deleted.`
              : `Publishes this post to ${siteWpUrl}. The post becomes visible to readers immediately. You can unpublish later from this screen.`
          }
          confirmLabel={actionState === "publishing" ? "Publishing…" : "Publish"}
          destructive={false}
          onCancel={() => setPublishOpen(false)}
          onConfirm={handlePublish}
          submitting={actionState === "publishing"}
        />
      )}

      {unpublishOpen && (
        <ConfirmModal
          title="Send this post to WP trash?"
          body={`This removes the post from the live site at ${wpFrontendUrl ?? siteWpUrl}. WordPress keeps it in Trash (recoverable via WP Admin → Posts → Trash). Opollo flips the status back to Draft; you can re-publish any time.`}
          confirmLabel={actionState === "unpublishing" ? "Unpublishing…" : "Unpublish"}
          destructive={true}
          onCancel={() => setUnpublishOpen(false)}
          onConfirm={handleUnpublish}
          submitting={actionState === "unpublishing"}
        />
      )}
    </div>
  );
}

function ConfirmModal({
  title,
  body,
  confirmLabel,
  destructive,
  onCancel,
  onConfirm,
  submitting,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  destructive: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  submitting: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border bg-background p-6 shadow-lg">
        <h2 id="confirm-title" className="text-lg font-semibold">
          {title}
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">{body}</p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={submitting}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
