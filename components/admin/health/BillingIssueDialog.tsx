"use client";

import { useState } from "react";

import { MONITORED_SERVICES } from "./ServiceStatusGrid";

interface Props {
  defaultService: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function BillingIssueDialog({ defaultService, onClose, onSuccess }: Props) {
  const [service, setService] = useState(defaultService);
  const [issueType, setIssueType] = useState<"billing" | "auth" | "other">("billing");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/service-health/flag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service_name: service, issue_type: issueType, notes }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit flag");
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="flag-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
        <h2 id="flag-dialog-title" className="text-base font-semibold">
          Flag service for review
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Creates a critical alert and notifies all platform admins.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          <div>
            <label
              htmlFor="flag-service"
              className="mb-1 block text-sm font-medium"
            >
              Service
            </label>
            <select
              id="flag-service"
              value={service}
              onChange={(e) => setService(e.target.value)}
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
              required
            >
              {MONITORED_SERVICES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="flag-issue-type"
              className="mb-1 block text-sm font-medium"
            >
              Issue type
            </label>
            <select
              id="flag-issue-type"
              value={issueType}
              onChange={(e) =>
                setIssueType(e.target.value as "billing" | "auth" | "other")
              }
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="billing">Billing</option>
              <option value="auth">Auth</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="flag-notes"
              className="mb-1 block text-sm font-medium"
            >
              Notes <span className="text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id="flag-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="e.g. Received billing failure email from vendor at 9am AEST"
              className="w-full resize-none rounded border border-border bg-background px-2 py-1.5 text-sm"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              data-testid="flag-submit"
              className="rounded bg-destructive px-3 py-1.5 text-sm text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
