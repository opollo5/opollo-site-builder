"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusPill, postStatusKind } from "@/components/ui/status-pill";
import { H1 } from "@/components/ui/typography";
import type { PostDetail } from "@/lib/posts";
import type { PreflightResult } from "@/lib/site-preflight";

// ---------------------------------------------------------------------------
// M13-4 — post detail + publish/unpublish controls.
//
// Renders:
//   - Back to posts link + title + slug + status pill + WP post id
//   - Preflight blocker (translated) when preflight failed
//   - Rendered HTML preview in <iframe sandbox="">
//   - Publish button (fires directly, no confirm modal — additive action)
//   - Unpublish button (only when status='published'), behind a
//     confirm modal naming the WP URL that will be trashed
//   - View live button when published
//   - Inline error surface for API failures
//
// Assistive-operator-flow contract: Publish is NOT gated behind a modal
// because it's additive (trashable via WP if the operator changes their
// mind). Unpublish IS gated because the "visible-to-readers → not-visible"
// transition warrants an explicit confirmation step.
// ---------------------------------------------------------------------------

type ActionState = "idle" | "publishing" | "unpublishing";

// Spec 07 PR A — Tiptap saves blank documents as "<p></p>" / "<p><br></p>",
// which the previous truthy check rendered as a blank iframe. Strip tags +
// nbsp + zero-width chars before deciding.
function isHtmlEffectivelyEmpty(html: string | null | undefined): boolean {
  if (!html) return true;
  const stripped = html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;| |​|‌|‍|﻿/g, "")
    .trim();
  return stripped.length === 0;
}

// Spec 07 PR A — wrap generated_html in a minimal styled document so the
// iframe preview renders with sensible typography even before any
// site-level CSS is loaded.
//
// Sanitisation note: rendering happens in <iframe sandbox=""> with NO
// allow-scripts / allow-same-origin / allow-forms — the browser blocks
// every active content type. This is stricter than DOMPurify-plus-
// dangerouslySetInnerHTML because nothing inside the frame can execute
// or reach the parent. Provenance: relying on browser-native sandbox
// per https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox.
function wrapPreviewDocument(rawHtml: string): string {
  const styles = [
    "body{margin:16px;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#111827}",
    "h1{font-size:24px;line-height:1.25;margin:0 0 12px;font-weight:700}",
    "h2{font-size:20px;line-height:1.3;margin:20px 0 10px;font-weight:700}",
    "h3{font-size:18px;line-height:1.35;margin:16px 0 8px;font-weight:600}",
    "p{margin:0 0 12px}",
    "ul,ol{margin:0 0 12px 20px;padding:0}",
    "li{margin:4px 0}",
    "blockquote{margin:0 0 12px;padding:8px 12px;border-left:3px solid #e5e7eb;color:#374151}",
    "code{background:#f3f4f6;padding:1px 4px;border-radius:3px;font-size:14px;font-family:ui-monospace,monospace}",
    "pre{background:#f3f4f6;padding:12px;border-radius:6px;overflow:auto;font-size:13px}",
    "img{max-width:100%;height:auto}",
    "a{color:#2563eb;text-decoration:underline}",
  ].join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${styles}</style></head><body>${rawHtml}</body></html>`;
}

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

  const preflightBlocked = preflight.ok === false;
  const canPublish =
    !preflightBlocked &&
    post.generated_html !== null &&
    post.generated_html.trim() !== "" &&
    post.status !== "published";

  const canUnpublish = post.status === "published" && post.wp_post_id !== null;

  const wpBase = siteWpUrl.replace(/\/+$/, "");
  const wpFrontendUrl = post.wp_post_id
    ? `${wpBase}/?p=${post.wp_post_id}`
    : null;
  const expectedUrl = `${wpBase}/${post.slug}`;

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
        toast.success("Published to WordPress!", {
          description: wpFrontendUrl ? "Your post is now live." : undefined,
          action: wpFrontendUrl
            ? { label: "View live", onClick: () => window.open(wpFrontendUrl, "_blank") }
            : undefined,
        });
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
        toast.success("Post moved to WordPress trash. You can re-publish any time.");
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
          <Link
            href={`/admin/sites/${siteId}/posts`}
            className="text-sm text-muted-foreground underline hover:text-foreground"
          >
            ← Back to posts
          </Link>
          <H1 className="mt-2">{post.title}</H1>
          <p className="mt-1 text-sm text-muted-foreground">
            <code className="text-sm">/{post.slug}</code>
            {" · "}
            <StatusPill kind={postStatusKind(post.status)} className="capitalize" />
            {post.wp_post_id && (
              <>
                {" · "}
                <span className="text-sm">WP id {post.wp_post_id}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {post.status === "published" && wpFrontendUrl && (
            <Button type="button" variant="outline" asChild>
              <a href={wpFrontendUrl} target="_blank" rel="noreferrer">
                View live ↗
              </a>
            </Button>
          )}
          {canPublish && (
            <Button
              type="button"
              onClick={handlePublish}
              disabled={actionState !== "idle"}
            >
              {actionState === "publishing"
                ? "Publishing…"
                : post.wp_post_id
                  ? "Re-publish to WP"
                  : "Publish to WP"}
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
        <Alert
          variant="warning"
          data-testid="preflight-blocker"
          title={
            "blocker" in preflight
              ? preflight.blocker.title
              : "Preflight failed."
          }
        >
          {"blocker" in preflight && (
            <>
              <p>{preflight.blocker.detail}</p>
              <p className="mt-2 text-sm">
                <strong>What to do:</strong> {preflight.blocker.nextAction}
              </p>
            </>
          )}
        </Alert>
      )}

      {errorMessage && <Alert variant="destructive">{errorMessage}</Alert>}

      <section
        aria-labelledby="preview-heading"
        className="rounded-lg border p-4"
      >
        <h2 id="preview-heading" className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Content preview
        </h2>
        {post.status === "published" && wpFrontendUrl ? (
          <iframe
            src={wpFrontendUrl}
            sandbox="allow-same-origin allow-scripts allow-popups"
            className="mt-3 h-96 w-full rounded border"
            title={`Live preview of ${post.title}`}
          />
        ) : !isHtmlEffectivelyEmpty(post.generated_html) ? (
          <iframe
            sandbox=""
            srcDoc={wrapPreviewDocument(post.generated_html ?? "")}
            className="mt-3 h-[32rem] w-full rounded border"
            title={`Draft preview of ${post.title}`}
          />
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No content yet — add content via the post editor.
          </p>
        )}
      </section>

      {post.excerpt && (
        <section className="rounded-lg border p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Excerpt / Meta description
          </h2>
          <p className="mt-2 text-sm">{post.excerpt}</p>
        </section>
      )}

      <section className="rounded-lg border p-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          WordPress URL
        </h2>
        {post.status === "published" && wpFrontendUrl ? (
          <p className="mt-2 text-sm">
            <a
              href={wpFrontendUrl}
              target="_blank"
              rel="noreferrer"
              className="underline hover:no-underline"
            >
              {wpFrontendUrl}
            </a>
            <span className="ml-2 text-muted-foreground">(live)</span>
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Expected URL after publish:{" "}
            <span className="font-mono">{expectedUrl}</span>
          </p>
        )}
      </section>

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
