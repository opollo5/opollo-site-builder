"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";

type FormState = {
  tokens_css: string;
  base_styles: string;
  notes: string;
};

const INITIAL_STATE: FormState = {
  tokens_css: "",
  base_styles: "",
  notes: "",
};

function Label({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium">
      {children}
    </label>
  );
}

function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-destructive">{message}</p>;
}

export function CreateDesignSystemModal({
  open,
  siteId,
  onClose,
  onSuccess,
}: {
  open: boolean;
  siteId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof FormState, string>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(INITIAL_STATE);
      setFieldErrors({});
      setFormError(null);
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

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  }

  function validateClient(): boolean {
    const errs: Partial<Record<keyof FormState, string>> = {};
    // tokens_css and base_styles are string-required at the DB — the M1b
    // Zod schema accepts empty strings, so we don't enforce non-empty here.
    // Operators who want a blank draft and intend to paste later are fine.
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!validateClient()) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/design-systems`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tokens_css: form.tokens_css,
          base_styles: form.base_styles,
          notes: form.notes.trim().length > 0 ? form.notes : null,
        }),
      });
      let payload: any = null;
      try {
        payload = await res.json();
      } catch {
        /* ignore */
      }

      if (res.ok && payload?.ok) {
        onSuccess();
        onClose();
        return;
      }

      const code = payload?.error?.code;
      if (code === "VALIDATION_FAILED" && payload?.error?.details?.issues) {
        const errs: Partial<Record<keyof FormState, string>> = {};
        for (const issue of payload.error.details.issues) {
          const key = issue.path?.split(".")?.[0] as
            | keyof FormState
            | undefined;
          if (key && key in INITIAL_STATE) errs[key] = issue.message;
        }
        setFieldErrors(errs);
        if (Object.keys(errs).length === 0) {
          setFormError(payload.error.message ?? "Validation failed.");
        }
      } else {
        setFormError(
          payload?.error?.message ??
            `Request failed (HTTP ${res.status}). Please try again.`,
        );
      }
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
      aria-labelledby="new-ds-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-lg border bg-background p-6 shadow-lg">
        <h2 id="new-ds-title" className="text-lg font-semibold">
          New design system draft
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Version number is auto-assigned to the next integer. The draft is
          not activated — you can edit components and templates, then activate
          from the list when ready.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <Label htmlFor="ds-tokens">tokens.css</Label>
            <textarea
              id="ds-tokens"
              className="mt-1 h-40 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
              value={form.tokens_css}
              onChange={(e) => setField("tokens_css", e.target.value)}
              placeholder=".ls-scope {\n  --ls-blue: #185FA5;\n  /* ... */\n}"
              spellCheck={false}
              disabled={submitting}
              autoFocus
            />
            <FieldError message={fieldErrors.tokens_css} />
          </div>

          <div>
            <Label htmlFor="ds-base-styles">base-styles.css</Label>
            <textarea
              id="ds-base-styles"
              className="mt-1 h-40 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
              value={form.base_styles}
              onChange={(e) => setField("base_styles", e.target.value)}
              placeholder=".ls-container { max-width: 1160px; }"
              spellCheck={false}
              disabled={submitting}
            />
            <FieldError message={fieldErrors.base_styles} />
          </div>

          <div>
            <Label htmlFor="ds-notes">Notes (optional)</Label>
            <textarea
              id="ds-notes"
              className="mt-1 h-20 w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={form.notes}
              onChange={(e) => setField("notes", e.target.value)}
              placeholder="What changed in this version?"
              disabled={submitting}
            />
            <FieldError message={fieldErrors.notes} />
          </div>

          {formError && (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              role="alert"
            >
              {formError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create draft"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
