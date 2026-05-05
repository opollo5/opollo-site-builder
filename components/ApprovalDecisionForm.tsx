"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// S1-7 — decision form for the magic-link viewer.
//
// Three buttons (Approve / Request changes / Reject) + a comment box.
// Submission posts to /api/approve/[token]/decision; on success the
// page surfaces a "thanks" panel. The form itself is otherwise stateless
// — no optimistic updates, the server's response is the source of truth.
// ---------------------------------------------------------------------------

type Decision = "approved" | "rejected" | "changes_requested";

type Props = {
  token: string;
  // Initial state read on the server. If the request is already
  // finalised, the page wraps this in a "thanks, already done" panel
  // instead of rendering the form.
  alreadyDecided: boolean;
};

const LABEL: Record<Decision, string> = {
  approved: "Approve",
  changes_requested: "Request changes",
  rejected: "Reject",
};

const VARIANT: Record<Decision, "default" | "secondary" | "destructive"> = {
  approved: "default",
  changes_requested: "secondary",
  rejected: "destructive",
};

export function ApprovalDecisionForm({ token, alreadyDecided }: Props) {
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState<Decision | null>(null);
  const [done, setDone] = useState<{ decision: Decision } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (alreadyDecided) {
    return (
      <div
        className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900"
        data-testid="approval-already-decided"
      >
        <p className="font-medium">This request has already been resolved.</p>
        <p className="mt-1">
          Thanks for your time — no further action is needed from you.
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div
        className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900"
        data-testid="approval-decision-done"
      >
        <p className="font-medium">Decision recorded — thank you.</p>
        <p className="mt-1">
          {done.decision === "approved"
            ? "The team has been notified that you approved this post."
            : done.decision === "rejected"
              ? "The team has been notified that you rejected this post."
              : "The team has been notified that you'd like changes."}
        </p>
      </div>
    );
  }

  async function submit(decision: Decision) {
    setSubmitting(decision);
    setError(null);
    try {
      const res = await fetch(`/api/approve/${token}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          comment: comment.trim() || null,
        }),
      });
      const json = (await res.json()) as
        | { ok: true; data: unknown }
        | { ok: false; error: { message: string } };
      if (!res.ok || !json.ok) {
        const msg = !json.ok ? json.error.message : "Failed to record decision.";
        setError(msg);
        return;
      }
      setDone({ decision });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <section className="mt-6" data-testid="approval-decision-form">
      <label className="block text-sm font-medium" htmlFor="approval-comment">
        Comment (optional)
      </label>
      <textarea
        id="approval-comment"
        className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
        rows={4}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Add a note for the team — what needs changing, why you're rejecting, etc."
        data-testid="approval-comment"
      />

      {error ? (
        <p
          className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
          data-testid="approval-decision-error"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {(["approved", "changes_requested", "rejected"] as Decision[]).map(
          (d) => (
            <Button
              key={d}
              variant={VARIANT[d]}
              onClick={() => submit(d)}
              disabled={submitting !== null}
              data-testid={`approval-decision-${d}`}
            >
              {submitting === d ? "Submitting…" : LABEL[d]}
            </Button>
          ),
        )}
      </div>
    </section>
  );
}
