"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

// Generic confirmation modal for mutating actions that need a server
// round-trip. Used by the version manager (POST activate / POST archive)
// and the components/templates editors (DELETE with a query param).
//
// Two request shapes via a discriminated union so DELETE endpoints can
// pass expected_version_lock as ?query param rather than a body — DELETE
// bodies are unreliable across proxies and we took that choice at M1e-1.

export type ConfirmActionSuccess = {
  ok: true;
  data: unknown;
};

export type ConfirmActionRequest =
  | { method: "POST"; body: Record<string, unknown> }
  | { method: "DELETE"; searchParams: Record<string, string | number> };

export type ConfirmActionModalProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: "default" | "destructive";
  endpoint: string;
  request: ConfirmActionRequest;
  // When the API envelope's data contains a warnings[] string array, surface
  // them here so operators notice (archive returns warnings when the site
  // would end up with no active DS; delete-component warns about orphaned
  // template refs).
  warningsAccessor?: (data: unknown) => string[] | undefined;
  // Optional block of additional content rendered inside the modal body —
  // used for pre-confirm orphan warnings, sample previews, etc.
  extraContent?: React.ReactNode;
  onClose: () => void;
  onSuccess: (payload: ConfirmActionSuccess) => void;
};

function buildUrl(
  endpoint: string,
  searchParams: Record<string, string | number>,
): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) qs.set(k, String(v));
  const sep = endpoint.includes("?") ? "&" : "?";
  return qs.toString().length === 0 ? endpoint : `${endpoint}${sep}${qs}`;
}

export function ConfirmActionModal({
  open,
  title,
  description,
  confirmLabel,
  confirmVariant = "default",
  endpoint,
  request,
  warningsAccessor,
  extraContent,
  onClose,
  onSuccess,
}: ConfirmActionModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);

  useEffect(() => {
    if (open) {
      setSubmitting(false);
      setFormError(null);
      setWarnings(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  if (!open) return null;

  async function handleConfirm() {
    setSubmitting(true);
    setFormError(null);
    setWarnings(null);
    try {
      let res: Response;
      if (request.method === "POST") {
        res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request.body),
        });
      } else {
        res = await fetch(buildUrl(endpoint, request.searchParams), {
          method: "DELETE",
        });
      }

      let payload: any = null;
      try {
        payload = await res.json();
      } catch {
        /* ignore */
      }

      if (res.ok && payload?.ok) {
        const derived = warningsAccessor?.(payload.data) ?? null;
        if (derived && derived.length > 0) {
          setWarnings(derived);
          onSuccess({ ok: true, data: payload.data });
          return;
        }
        onSuccess({ ok: true, data: payload.data });
        onClose();
        return;
      }

      setFormError(
        payload?.error?.message ??
          `Request failed (HTTP ${res.status}). Please try again.`,
      );
    } catch (err) {
      setFormError(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
        <h2 id="confirm-title" className="text-lg font-semibold">
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>

        {extraContent && <div className="mt-4">{extraContent}</div>}

        {warnings && warnings.length > 0 && (
          <div
            className="mt-4 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-900 dark:text-yellow-200"
            role="status"
          >
            <p className="font-medium">Completed with warnings:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {formError && (
          <div
            className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            role="alert"
          >
            {formError}
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
          >
            {warnings ? "Close" : "Cancel"}
          </Button>
          {!warnings && (
            <Button
              type="button"
              variant={confirmVariant === "destructive" ? "destructive" : "default"}
              onClick={handleConfirm}
              disabled={submitting}
            >
              {submitting ? "Working…" : confirmLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
