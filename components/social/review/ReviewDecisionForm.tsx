"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ReviewDecisionFormProps {
  draftId: string;
  /** JWT review token from the /review/[token] URL. When present, the form
   * submits to the public /api/review/[token]/decision route (D5 magic-link
   * auth) instead of the session-gated platform approve route. */
  reviewToken?: string;
  disabled?: boolean;
}

type Decision = "approved" | "rejected";

export function ReviewDecisionForm({ draftId, reviewToken, disabled = false }: ReviewDecisionFormProps) {
  const [decision, setDecision] = React.useState<Decision | null>(null);
  const [rejectionReason, setRejectionReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const minReasonChars = 30;
  const reasonTooShort = rejectionReason.length < minReasonChars;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!decision) return;
    if (decision === "rejected" && reasonTooShort) return;

    setError(null);
    setSubmitting(true);

    try {
      const body: Record<string, unknown> = { decision };
      if (decision === "rejected") body.rejection_reason = rejectionReason;

      // D5: when a review token is present, use the public magic-link route
      // so external approvers don't need a Supabase session.
      const url = reviewToken
        ? `/api/review/${reviewToken}/decision`
        : `/api/platform/social/drafts/${draftId}/approve`;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data?.error?.message ?? `Request failed (${res.status})`);
      }

      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-border bg-card px-5 py-6 text-center">
        <p className="text-base font-medium text-foreground">
          {decision === "approved" ? "Post approved." : "Post rejected."}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {decision === "approved"
            ? "The post will be scheduled for publishing."
            : "The author has been notified."}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {/* Approve / Reject buttons */}
      <div className="flex gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setDecision("approved")}
          className={cn(
            "flex-1 rounded-md border px-4 py-3 text-sm font-medium transition-colors",
            decision === "approved"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-background text-foreground hover:bg-muted",
            disabled && "pointer-events-none opacity-50",
          )}
        >
          Approve
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setDecision("rejected")}
          className={cn(
            "flex-1 rounded-md border px-4 py-3 text-sm font-medium transition-colors",
            decision === "rejected"
              ? "border-destructive bg-destructive/10 text-destructive"
              : "border-border bg-background text-foreground hover:bg-muted",
            disabled && "pointer-events-none opacity-50",
          )}
        >
          Reject
        </button>
      </div>

      {/* Rejection reason — required, 30-500 chars */}
      {decision === "rejected" && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">
            Rejection reason <span className="text-muted-foreground">(required)</span>
          </label>
          <textarea
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            rows={4}
            maxLength={500}
            placeholder="Describe why this post needs changes (minimum 30 characters)"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
          <p className={cn("text-xs", reasonTooShort && rejectionReason.length > 0 ? "text-destructive" : "text-muted-foreground")}>
            {rejectionReason.length} / 500 {reasonTooShort ? `(minimum ${minReasonChars})` : ""}
          </p>
        </div>
      )}

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {decision && (
        <Button
          type="submit"
          disabled={
            disabled ||
            submitting ||
            (decision === "rejected" && reasonTooShort)
          }
        >
          {submitting
            ? "Submitting…"
            : decision === "approved"
            ? "Confirm approval"
            : "Confirm rejection"}
        </Button>
      )}
    </form>
  );
}
