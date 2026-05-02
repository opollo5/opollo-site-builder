"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DesignTemplate } from "@/lib/templates";

type FormState = {
  page_type: string;
  name: string;
  is_default: boolean;
  composition: string; // JSON text
  required_fields: string; // JSON text
  seo_defaults: string; // JSON text (optional)
};

const INITIAL: FormState = {
  page_type: "",
  name: "",
  is_default: false,
  composition:
    '[\n  { "component": "nav-default", "content_source": "site_context.nav" }\n]',
  required_fields: "{}",
  seo_defaults: "",
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
  return <p className="mt-1 text-sm text-destructive">{message}</p>;
}

function FieldWarning({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p className="mt-1 text-sm text-yellow-700 dark:text-yellow-400">{message}</p>;
}

function initialFromTemplate(t: DesignTemplate): FormState {
  return {
    page_type: t.page_type,
    name: t.name,
    is_default: t.is_default,
    composition: JSON.stringify(t.composition ?? [], null, 2),
    required_fields: JSON.stringify(t.required_fields ?? {}, null, 2),
    seo_defaults: t.seo_defaults
      ? JSON.stringify(t.seo_defaults, null, 2)
      : "",
  };
}

export type TemplateFormMode =
  | { kind: "create" }
  | { kind: "edit"; template: DesignTemplate };

export function TemplateFormModal({
  open,
  mode,
  designSystemId,
  availableComponentNames,
  onClose,
  onSuccess,
}: {
  open: boolean;
  mode: TemplateFormMode;
  designSystemId: string;
  // Component names that currently exist in the DS. Used for the non-blocking
  // composition-reference warning in the JSON textarea.
  availableComponentNames: string[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const initial = useMemo<FormState>(
    () => (mode.kind === "edit" ? initialFromTemplate(mode.template) : INITIAL),
    [mode],
  );
  const [form, setForm] = useState<FormState>(initial);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof FormState, string>>
  >({});
  const [fieldWarnings, setFieldWarnings] = useState<
    Partial<Record<keyof FormState, string>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(initial);
      setFieldErrors({});
      setFieldWarnings({});
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

  // Non-blocking reference check on composition. Fires whenever composition
  // text changes — operators who plan to create a component next get a
  // warning, not a hard error.
  useEffect(() => {
    if (form.composition.trim().length === 0) {
      setFieldWarnings((prev) => ({ ...prev, composition: undefined }));
      return;
    }
    try {
      const parsed = JSON.parse(form.composition);
      if (!Array.isArray(parsed)) return;
      const refs = parsed
        .filter(
          (x): x is { component: string } =>
            x !== null &&
            typeof x === "object" &&
            typeof (x as { component?: unknown }).component === "string",
        )
        .map((x) => x.component);
      const missing = refs.filter((r) => !availableComponentNames.includes(r));
      if (missing.length > 0) {
        setFieldWarnings((prev) => ({
          ...prev,
          composition: `References to components not in this design system yet: ${missing.join(", ")}. Not blocking — create them before activating the template.`,
        }));
      } else {
        setFieldWarnings((prev) => ({ ...prev, composition: undefined }));
      }
    } catch {
      // Parse errors surface on submit via fieldErrors — don't pile on.
    }
  }, [form.composition, availableComponentNames]);

  if (!open) return null;

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  }

  function validateClient(): {
    ok: boolean;
    parsedComposition?: unknown;
    parsedRequired?: unknown;
    parsedSeo?: unknown;
  } {
    const errs: Partial<Record<keyof FormState, string>> = {};

    if (mode.kind === "create") {
      if (form.page_type.trim().length === 0) {
        errs.page_type = "Required.";
      }
    }
    if (form.name.trim().length === 0) {
      errs.name = "Required.";
    }

    let parsedComposition: unknown = [];
    try {
      parsedComposition = JSON.parse(form.composition);
      if (!Array.isArray(parsedComposition) || parsedComposition.length === 0) {
        errs.composition = "Must be a non-empty JSON array.";
      }
    } catch (e) {
      errs.composition = `Invalid JSON: ${
        e instanceof Error ? e.message : String(e)
      }`;
    }

    let parsedRequired: unknown = {};
    try {
      parsedRequired = JSON.parse(form.required_fields);
      if (typeof parsedRequired !== "object" || parsedRequired === null) {
        errs.required_fields = "Must be a JSON object.";
      }
    } catch (e) {
      errs.required_fields = `Invalid JSON: ${
        e instanceof Error ? e.message : String(e)
      }`;
    }

    let parsedSeo: unknown = null;
    if (form.seo_defaults.trim().length > 0) {
      try {
        parsedSeo = JSON.parse(form.seo_defaults);
        if (typeof parsedSeo !== "object" || parsedSeo === null) {
          errs.seo_defaults = "Must be a JSON object (or leave blank).";
        }
      } catch (e) {
        errs.seo_defaults = `Invalid JSON: ${
          e instanceof Error ? e.message : String(e)
        }`;
      }
    }

    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return { ok: false };
    return {
      ok: true,
      parsedComposition,
      parsedRequired,
      parsedSeo,
    };
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const check = validateClient();
    if (!check.ok) return;

    setSubmitting(true);
    try {
      let res: Response;
      if (mode.kind === "create") {
        res = await fetch(
          `/api/design-systems/${designSystemId}/templates`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              page_type: form.page_type,
              name: form.name,
              is_default: form.is_default,
              composition: check.parsedComposition,
              required_fields: check.parsedRequired,
              seo_defaults:
                form.seo_defaults.trim().length > 0 ? check.parsedSeo : null,
            }),
          },
        );
      } else {
        const patch: Record<string, unknown> = {
          name: form.name,
          is_default: form.is_default,
          composition: check.parsedComposition,
          required_fields: check.parsedRequired,
          seo_defaults:
            form.seo_defaults.trim().length > 0 ? check.parsedSeo : null,
          expected_version_lock: mode.template.version_lock,
        };
        res = await fetch(
          `/api/design-systems/${designSystemId}/templates/${mode.template.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(patch),
          },
        );
      }

      const payload = await res.json().catch(() => null);
      if (res.ok && payload?.ok) {
        onSuccess();
        onClose();
        return;
      }

      const code = payload?.error?.code;
      if (code === "VALIDATION_FAILED" && payload?.error?.details) {
        const details = payload.error.details as {
          issues?: Array<{ path?: string; message?: string }>;
          unknown_components?: string[];
        };
        if (
          Array.isArray(details.unknown_components) &&
          details.unknown_components.length > 0
        ) {
          setFieldErrors({
            composition: `Server rejected composition — references missing components: ${details.unknown_components.join(", ")}.`,
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
      ? "New template"
      : `Edit template · ${mode.template.page_type}/${mode.template.name}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="template-form-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg border bg-background p-6 shadow-lg">
        <h2 id="template-form-title" className="text-lg font-semibold">
          {title}
        </h2>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="tf-page-type">Page type</Label>
              <Input
                id="tf-page-type"
                value={form.page_type}
                onChange={(e) => setField("page_type", e.target.value)}
                placeholder="homepage"
                readOnly={mode.kind === "edit"}
                className={
                  mode.kind === "edit" ? "cursor-not-allowed opacity-60" : ""
                }
                disabled={submitting}
              />
              <FieldError message={fieldErrors.page_type} />
              {mode.kind === "edit" && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Page type is immutable after create.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="tf-name">Name</Label>
              <Input
                id="tf-name"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="homepage-default"
                disabled={submitting}
              />
              <FieldError message={fieldErrors.name} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="tf-is-default"
              type="checkbox"
              checked={form.is_default}
              onChange={(e) => setField("is_default", e.target.checked)}
              disabled={submitting}
            />
            <label htmlFor="tf-is-default" className="text-sm">
              Default for this page type (only one per DS × page_type)
            </label>
          </div>

          <div>
            <Label htmlFor="tf-composition">Template composition</Label>
            <textarea
              id="tf-composition"
              className="mt-1 h-48 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
              value={form.composition}
              onChange={(e) => setField("composition", e.target.value)}
              spellCheck={false}
              disabled={submitting}
            />
            <FieldError message={fieldErrors.composition} />
            <FieldWarning message={fieldWarnings.composition} />
            <p className="mt-1 text-sm text-muted-foreground">
              Ordered array of {"{"} component, content_source {"}"} entries.
              Every <code>component</code> must resolve to a component in this
              design system — a warning shows above if one doesn&apos;t.
            </p>
          </div>

          <div>
            <Label htmlFor="tf-required">Required fields per component</Label>
            <textarea
              id="tf-required"
              className="mt-1 h-24 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
              value={form.required_fields}
              onChange={(e) => setField("required_fields", e.target.value)}
              spellCheck={false}
              disabled={submitting}
            />
            <FieldError message={fieldErrors.required_fields} />
          </div>

          <div>
            <Label htmlFor="tf-seo">SEO defaults (optional)</Label>
            <textarea
              id="tf-seo"
              className="mt-1 h-20 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
              value={form.seo_defaults}
              onChange={(e) => setField("seo_defaults", e.target.value)}
              spellCheck={false}
              disabled={submitting}
            />
            <FieldError message={fieldErrors.seo_defaults} />
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
                  ? "Create template"
                  : "Save changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
