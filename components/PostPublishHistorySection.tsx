"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  PLATFORM_LABEL,
  type SocialPlatform,
} from "@/lib/platform/social/variants/types";

// ---------------------------------------------------------------------------
// S1-21 — publish history section on the post detail page.
//
// Visible when post.state IN ('publishing','published','failed') and
// at least one publish_attempt row exists. Shows the chronological
// list (newest first) with platform, status pill, completed_at, error
// summary on failures, and a Retry button on each failed attempt
// (admin/approver-only via canRetry).
//
// Retry POSTs to /api/platform/social/publish-attempts/[id]/retry.
// On 200 ok with outcome='ok' or 'publish_failed' we re-fetch the
// list (a new attempt landed). Other outcomes (already_retrying,
// invalid_state, no_connection, connection_degraded) flash a banner
// and don't re-fetch.
// ---------------------------------------------------------------------------

type Attempt = {
  id: string;
  platform: SocialPlatform;
  status: string;
  bundle_post_id: string | null;
  platform_post_url: string | null;
  error_class: string | null;
  retry_count: number;
  original_attempt_id: string | null;
  started_at: string;
  completed_at: string | null;
};

type Props = {
  postId: string;
  companyId: string;
  initialAttempts: Attempt[];
  canRetry: boolean;
};

const STATUS_PILL: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  in_flight: "bg-amber-100 text-amber-900",
  unknown: "bg-amber-100 text-amber-900",
  succeeded: "bg-emerald-100 text-emerald-900",
  failed: "bg-rose-100 text-rose-900",
  reconciling: "bg-amber-100 text-amber-900",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  in_flight: "Publishing…",
  unknown: "Pending confirmation",
  succeeded: "Published",
  failed: "Failed",
  reconciling: "Reconciling",
};

const ERROR_LABEL: Record<string, string> = {
  network: "Network error — retry may resolve",
  rate_limit: "Rate-limited by the platform — retry shortly",
  platform_error: "Platform-side error",
  auth: "Authentication failed — reconnect the account",
  content_rejected: "Platform rejected the content",
  media_invalid: "Media could not be processed",
  unknown: "Unknown error",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PostPublishHistorySection({
  postId,
  companyId,
  initialAttempts,
  canRetry,
}: Props) {
  const [attempts, setAttempts] = useState(initialAttempts);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: "info" | "error"; message: string } | null>(
    null,
  );

  async function refetch() {
    const res = await fetch(
      `/api/platform/social/posts/${postId}/publish-attempts?company_id=${encodeURIComponent(companyId)}`,
    );
    if (!res.ok) return;
    const json = (await res.json()) as
      | { ok: true; data: { attempts: Attempt[] } }
      | { ok: false };
    if (json.ok) setAttempts(json.data.attempts);
  }

  async function handleRetry(attemptId: string) {
    setRetryingId(attemptId);
    setFlash(null);
    try {
      const res = await fetch(
        `/api/platform/social/publish-attempts/${attemptId}/retry`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ company_id: companyId }),
        },
      );
      const json = (await res.json()) as
        | { ok: true; data: { outcome: string } }
        | { ok: false; error: { message: string } };
      if (!res.ok || !json.ok) {
        const msg = !json.ok ? json.error.message : "Failed to retry.";
        setFlash({ kind: "error", message: msg });
        return;
      }
      const outcome = json.data.outcome;
      if (outcome === "ok") {
        setFlash({ kind: "info", message: "Retry queued — new attempt in flight." });
        await refetch();
      } else if (outcome === "publish_failed") {
        setFlash({
          kind: "error",
          message: "Retry hit a fresh failure — see the new attempt below.",
        });
        await refetch();
      } else if (outcome === "already_retrying") {
        setFlash({
          kind: "info",
          message:
            "This attempt is already being retried — refresh to see the new one.",
        });
      } else if (outcome === "connection_degraded") {
        setFlash({
          kind: "error",
          message:
            "Connection needs reconnecting — visit Connections.",
        });
      } else if (outcome === "no_connection") {
        setFlash({
          kind: "error",
          message: "No healthy connection for that platform.",
        });
      } else {
        setFlash({ kind: "error", message: `Retry refused: ${outcome}.` });
      }
    } finally {
      setRetryingId(null);
    }
  }

  if (attempts.length === 0) {
    return null;
  }

  return (
    <section
      className="mt-6 rounded-lg border bg-card p-4"
      data-testid="publish-history-section"
    >
      <header className="mb-3">
        <h2 className="text-base font-semibold">Publish history</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Per-platform attempts. Failures stay visible so you can retry.
        </p>
      </header>

      {flash ? (
        <div
          className={
            flash.kind === "info"
              ? "mb-3 rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground"
              : "mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          }
          role={flash.kind === "error" ? "alert" : "status"}
          data-testid="publish-history-flash"
        >
          {flash.message}
        </div>
      ) : null}

      <ol className="divide-y">
        {attempts.map((a) => (
          <li
            key={a.id}
            className="flex items-start justify-between gap-4 py-3"
            data-testid={`publish-attempt-${a.id}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {PLATFORM_LABEL[a.platform] ?? a.platform}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-sm font-medium ${STATUS_PILL[a.status] ?? "bg-muted text-muted-foreground"}`}
                >
                  {STATUS_LABEL[a.status] ?? a.status}
                </span>
                {a.retry_count > 0 ? (
                  <span className="text-sm text-muted-foreground">
                    retry #{a.retry_count}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                Started {formatDate(a.started_at)}
                {a.completed_at ? ` · finished ${formatDate(a.completed_at)}` : ""}
              </div>
              {a.platform_post_url ? (
                <a
                  href={a.platform_post_url}
                  className="mt-1 block break-all text-sm text-primary underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View on platform
                </a>
              ) : null}
              {a.status === "failed" && a.error_class ? (
                <div className="mt-1 text-sm text-rose-700">
                  {ERROR_LABEL[a.error_class] ?? a.error_class}
                </div>
              ) : null}
            </div>
            {canRetry && a.status === "failed" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleRetry(a.id)}
                disabled={retryingId === a.id}
                data-testid={`publish-retry-${a.id}`}
              >
                {retryingId === a.id ? "Retrying…" : "Retry"}
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
