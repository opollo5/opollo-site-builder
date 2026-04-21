"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// M7-4 — Re-generate button.
//
// Click → window.confirm → POST /regenerate → 202 with job_id.
// When there's an in-flight job (pending or running), the button
// disables and a sibling polling effect drives router.refresh every
// 2s so the detail page's server-rendered history panel picks up the
// worker's state transitions without a full reload.
//
// Polling stops as soon as the status is terminal (succeeded / failed
// / failed_gates / cancelled). If the detail page renders with no
// in-flight job we don't start polling at all.
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 2000;

export function RegenerateButton({
  siteId,
  pageId,
  inFlightJobStatus,
}: {
  siteId: string;
  pageId: string;
  inFlightJobStatus: "pending" | "running" | null;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inFlight = inFlightJobStatus !== null;

  // Poll while there's an in-flight regen. router.refresh re-fetches
  // the server component tree, which re-reads regeneration_jobs and
  // pages.generated_html — the terminal transition propagates through.
  useEffect(() => {
    if (!inFlight) return;
    const interval = window.setInterval(() => {
      router.refresh();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [inFlight, router]);

  async function handleClick() {
    if (submitting || inFlight) return;
    const confirmed = window.confirm(
      "Re-generate this page? Anthropic will be called (costs tokens) and WordPress will be updated with the new HTML on success. This can't be cancelled mid-flight once the API call is in progress.",
    );
    if (!confirmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/sites/${encodeURIComponent(siteId)}/pages/${encodeURIComponent(pageId)}/regenerate`,
        { method: "POST" },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        setError(
          payload?.error?.message ?? `Regenerate failed (HTTP ${res.status}).`,
        );
        setSubmitting(false);
        return;
      }
      // Optimistic refresh so the polling effect picks up the new
      // in-flight row immediately.
      router.refresh();
      setSubmitting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={handleClick}
        disabled={submitting || inFlight}
        data-testid="regenerate-button"
      >
        {inFlightJobStatus === "running"
          ? "Regenerating…"
          : inFlightJobStatus === "pending"
            ? "Queued…"
            : submitting
              ? "Enqueuing…"
              : "Re-generate"}
      </Button>
      {error && (
        <p
          role="alert"
          className="max-w-xs text-right text-xs text-destructive"
          data-testid="regenerate-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}
