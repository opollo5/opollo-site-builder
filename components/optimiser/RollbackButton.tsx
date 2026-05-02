"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// Per-version rollback button + confirmation modal — addendum §4.4.
// Replaces the disabled placeholder that Slice 12 shipped on the score
// history table.

export function RollbackButton({
  pageId,
  historyId,
  versionLabel,
  classification,
  composite,
}: {
  pageId: string;
  historyId: string;
  versionLabel: string;
  classification: string;
  composite: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!reason.trim()) {
      setError("A reason is required for the audit trail.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/optimiser/pages/${pageId}/rollback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target_history_id: historyId,
          reason: reason.trim(),
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error?.message ?? "Rollback failed");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rollback failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-border bg-background px-2 py-1 text-sm hover:bg-muted"
      >
        Roll back
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`rollback-${historyId}-title`}
        >
          <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-background p-6 shadow-lg">
            <header className="space-y-1">
              <h2
                id={`rollback-${historyId}-title`}
                className="text-lg font-semibold"
              >
                Roll back to {versionLabel}
              </h2>
              <p className="text-sm text-muted-foreground">
                Restoring this version will mark the latest applied proposal
                as <code className="font-mono text-sm">applied_then_reverted</code>{" "}
                and re-evaluate the score against the restored content. The
                full audit trail goes into opt_change_log.
              </p>
            </header>
            <ul className="space-y-1 rounded-md border border-border bg-card p-3 text-sm">
              <li>
                <span className="text-muted-foreground">Target composite: </span>
                <span className="font-mono font-semibold">{composite}</span>{" "}
                <span className="text-sm text-muted-foreground">
                  ({classification.replace("_", " ")})
                </span>
              </li>
              <li>
                <span className="text-muted-foreground">When: </span>
                <span className="font-mono text-sm">{versionLabel}</span>
              </li>
            </ul>
            <div className="space-y-2">
              <label
                htmlFor={`rollback-reason-${historyId}`}
                className="block text-sm font-medium"
              >
                Reason (required for audit trail)
              </label>
              <Textarea
                id={`rollback-reason-${historyId}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Why is this rollback being initiated? e.g. 'CR dropped 20% over the last week, restoring last known-good version pending investigation.'"
              />
            </div>
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="button" onClick={confirm} disabled={submitting}>
                {submitting ? "Rolling back…" : "Confirm rollback"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
