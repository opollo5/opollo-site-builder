"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DesignComponent } from "@/lib/components";

// Single modal for both creating and editing components. The mode prop
// determines which API endpoint and HTTP verb to use, and whether the name
// field is editable (not after create — name is part of a uniqueness key).

type FormState = {
  name: string;
  variant: string;
  category: string;
  html_template: string;
  css: string;
  content_schema: string; // JSON text
  image_slots: string; // JSON text (optional)
  usage_notes: string;
};

const INITIAL: FormState = {
  name: "",
  variant: "",
  category: "",
  html_template: "",
  css: "",
  content_schema:
    '{\n  "type": "object",\n  "required": [],\n  "properties": {}\n}',
  image_slots: "",
  usage_notes: "",
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

function initialFromComponent(c: DesignComponent): FormState {
  return {
    name: c.name,
    variant: c.variant ?? "",
    category: c.category,
    html_template: c.html_template,
    css: c.css,
    content_schema: JSON.stringify(c.content_schema ?? {}, null, 2),
    image_slots: c.image_slots ? JSON.stringify(c.image_slots, null, 2) : "",
    usage_notes: c.usage_notes ?? "",
  };
}

export type ComponentFormMode =
  | { kind: "create" }
  | { kind: "edit"; component: DesignComponent };

export function ComponentFormModal({
  open,
  mode,
  designSystemId,
  onClose,
  onSuccess,
}: {
  open: boolean;
  mode: ComponentFormMode;
  designSystemId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const initial = useMemo<FormState>(
    () => (mode.kind === "edit" ? initialFromComponent(mode.component) : INITIAL),
    [mode],
  );
  const [form, setForm] = useState<FormState>(initial);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof FormState, string>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(initial);
      setFieldErrors({});
      setFormError(null);
    }
  }, [open, initial]);

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

  function validateClient(): {
    ok: boolean;
    parsedSchema?: unknown;
    parsedImageSlots?: unknown;
  } {
    const errs: Partial<Record<keyof FormState, string>> = {};

    if (mode.kind === "create") {
      if (!/^[a-z0-9-]+$/.test(form.name)) {
        errs.name = "Must be lowercase kebab-case (letters, digits, hyphens).";
      }
    }
    if (form.category.trim().length === 0) {
      errs.category = "Required.";
    }
    if (form.html_template.trim().length === 0) {
      errs.html_template = "Required.";
    }

    let parsedSchema: unknown = {};
    try {
      parsedSchema = JSON.parse(form.content_schema);
      if (typeof parsedSchema !== "object" || parsedSchema === null) {
        errs.content_schema = "Must be a JSON object.";
      }
    } catch (e) {
      errs.content_schema = `Invalid JSON: ${
        e instanceof Error ? e.message : String(e)
      }`;
    }

    let parsedImageSlots: unknown = null;
    if (form.image_slots.trim().length > 0) {
      try {
        parsedImageSlots = JSON.parse(form.image_slots);
        if (typeof parsedImageSlots !== "object" || parsedImageSlots === null) {
          errs.image_slots = "Must be a JSON object (or leave blank).";
        }
      } catch (e) {
        errs.image_slots = `Invalid JSON: ${
          e instanceof Error ? e.message : String(e)
        }`;
      }
    }

    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return { ok: false };
    return { ok: true, parsedSchema, parsedImageSlots };
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const check = validateClient();
    if (!check.ok) return;

    setSubmitting(true);
    try {
      const common = {
        variant: form.variant.trim().length > 0 ? form.variant : null,
        category: form.category,
        html_template: form.html_template,
        css: form.css,
        content_schema: check.parsedSchema,
        image_slots:
          form.image_slots.trim().length > 0 ? check.parsedImageSlots : null,
        usage_notes:
          form.usage_notes.trim().length > 0 ? form.usage_notes : null,
      };

      let res: Response;
      if (mode.kind === "create") {
        res = await fetch(
          `/api/design-systems/${designSystemId}/components`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: form.name, ...common }),
          },
        );
      } else {
        res = await fetch(
          `/api/design-systems/${designSystemId}/components/${mode.component.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              ...common,
              expected_version_lock: mode.component.version_lock,
            }),
          },
        );
      }

      const payload = await res.json().catch(() => null);
      if (res.ok && payload?.ok) {
        onSuccess();
        onClose();
        return;
      }

      // Field-mapping for Zod-issue payloads
      const code = payload?.error?.code;
      if (code === "VALIDATION_FAILED" && payload?.error?.details) {
        const details = payload.error.details as {
          issues?: Array<{ path?: string; message?: string }>;
          violations?: Array<{ selector?: string; line?: number }>;
          prefix?: string;
        };
        if (Array.isArray(details.violations) && details.violations.length > 0) {
          const pretty = details.violations
            .map((v) => `${v.selector ?? "?"} (line ${v.line ?? "?"})`)
            .join(", ");
          setFieldErrors({
            css: `Selectors not prefixed with ${details.prefix ?? "site prefix"}-: ${pretty}`,
          });
          setSubmitting(false);
          return;
        }
        if (Array.isArray(details.issues)) {
          const newErrs: Partial<Record<keyof FormState, string>> = {};
          for (const issue of details.issues) {
            const root = issue.path?.split(".")?.[0] as
              | keyof FormState
              | undefined;
            if (root && root in INITIAL) {
              newErrs[root] = issue.message ?? "Invalid.";
            }
          }
          if (Object.keys(newErrs).length > 0) {
            setFieldErrors(newErrs);
            setSubmitting(false);
            return;
          }
        }
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

  const title =
    mode.kind === "create"
      ? "New component"
      : `Edit component · ${mode.component.name}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="component-form-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg border bg-background p-6 shadow-lg">
        <h2 id="component-form-title" className="text-lg font-semibold">
          {title}
        </h2>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="cf-name">Name</Label>
              <Input
                id="cf-name"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                readOnly={mode.kind === "edit"}
                className={
                  mode.kind === "edit" ? "cursor-not-allowed opacity-60" : ""
                }
                placeholder="hero-with-showcase"
                disabled={submitting}
              />
              <FieldError message={fieldErrors.name} />
              {mode.kind === "edit" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Name is immutable after create — it&apos;s part of the uniqueness
                  key with variant.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="cf-variant">Variant (optional)</Label>
              <Input
                id="cf-variant"
                value={form.variant}
                onChange={(e) => setField("variant", e.target.value)}
                placeholder="default"
                disabled={submitting}
              />
              <FieldError message={fieldErrors.variant} />
            </div>
          </div>

          <div>
            <Label htmlFor="cf-category">Category</Label>
            <Input
              id="cf-category"
              value={form.category}
              onChange={(e) => setField("category", e.target.value)}
              placeholder="hero"
              disabled={submitting}
            />
            <FieldError message={fieldErrors.category} />
          </div>

          <div>
            <Label htmlFor="cf-html">HTML template</Label>
            <textarea
              id="cf-html"
              className="mt-1 h-40 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
              value={form.html_template}
              onChange={(e) => setField("html_template", e.target.value)}
              spellCheck={false}
              disabled={submitting}
            />
            <FieldError message={fieldErrors.html_template} />
          </div>

          <div>
            <Label htmlFor="cf-css">CSS</Label>
            <textarea
              id="cf-css"
              className="mt-1 h-40 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
              value={form.css}
              onChange={(e) => setField("css", e.target.value)}
              spellCheck={false}
              disabled={submitting}
            />
            <FieldError message={fieldErrors.css} />
            <p className="mt-1 text-xs text-muted-foreground">
              Every class selector must use the site&apos;s scope prefix (e.g.
              .ls-*). The server rejects unscoped CSS at submit time.
            </p>
          </div>

          <div>
            <Label htmlFor="cf-schema">Content shape (JSON Schema)</Label>
            <textarea
              id="cf-schema"
              className="mt-1 h-40 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
              value={form.content_schema}
              onChange={(e) => setField("content_schema", e.target.value)}
              spellCheck={false}
              disabled={submitting}
            />
            <FieldError message={fieldErrors.content_schema} />
          </div>

          <div>
            <Label htmlFor="cf-image-slots">Image slots (optional)</Label>
            <textarea
              id="cf-image-slots"
              className="mt-1 h-20 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
              value={form.image_slots}
              onChange={(e) => setField("image_slots", e.target.value)}
              spellCheck={false}
              disabled={submitting}
            />
            <FieldError message={fieldErrors.image_slots} />
          </div>

          <div>
            <Label htmlFor="cf-notes">Usage notes (optional)</Label>
            <textarea
              id="cf-notes"
              className="mt-1 h-20 w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={form.usage_notes}
              onChange={(e) => setField("usage_notes", e.target.value)}
              disabled={submitting}
            />
            <FieldError message={fieldErrors.usage_notes} />
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
              {submitting
                ? "Saving…"
                : mode.kind === "create"
                  ? "Create component"
                  : "Save changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
