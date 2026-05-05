"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type FormState = {
  name: string;
  wp_url: string;
  wp_user: string;
  wp_app_password: string;
};

const INITIAL_STATE: FormState = {
  name: "",
  wp_url: "",
  wp_user: "",
  wp_app_password: "",
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

export function AddSiteModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof FormState, string>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(INITIAL_STATE);
      setFieldErrors({});
      setFormError(null);
      setShowPassword(false);
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
    if (form.name.trim().length < 1 || form.name.length > 100) {
      errs.name = "Name must be 1–100 characters.";
    }
    try {
      new URL(form.wp_url);
    } catch {
      errs.wp_url = "Must be a valid URL (e.g. https://example.com).";
    }
    if (form.wp_user.trim().length < 1 || form.wp_user.length > 100) {
      errs.wp_user = "Required (1–100 characters).";
    }
    if (form.wp_app_password.length < 8) {
      errs.wp_app_password = "At least 8 characters.";
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!validateClient()) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/sites/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
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
      if (code === "PREFIX_TAKEN") {
        // Auto-generated prefix collided after exhausting every
        // candidate. Extremely rare but surfaces here as a top-level
        // form error rather than a field error — the operator has no
        // prefix field to correct.
        setFormError(payload.error.message);
      } else if (code === "VALIDATION_FAILED" && payload?.error?.details?.issues) {
        const errs: Partial<Record<keyof FormState, string>> = {};
        for (const issue of payload.error.details.issues) {
          const key = issue.path?.[0] as keyof FormState | undefined;
          if (key) errs[key] = issue.message;
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
      aria-labelledby="add-site-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
        <h2 id="add-site-title" className="text-lg font-semibold">
          Add new site
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Register a WordPress site. The app password is encrypted before
          storage.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <Label htmlFor="site-name">Name</Label>
            <Input
              id="site-name"
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              maxLength={100}
              disabled={submitting}
              autoFocus
            />
            <FieldError message={fieldErrors.name} />
          </div>

          <div>
            <Label htmlFor="site-wp-url">WordPress URL</Label>
            <Input
              id="site-wp-url"
              type="url"
              placeholder="https://example.com"
              value={form.wp_url}
              onChange={(e) => setField("wp_url", e.target.value)}
              disabled={submitting}
            />
            <FieldError message={fieldErrors.wp_url} />
          </div>

          <div>
            <Label htmlFor="site-wp-user">WordPress user</Label>
            <Input
              id="site-wp-user"
              value={form.wp_user}
              onChange={(e) => setField("wp_user", e.target.value)}
              maxLength={100}
              disabled={submitting}
            />
            <FieldError message={fieldErrors.wp_user} />
          </div>

          <div>
            <Label htmlFor="site-wp-password">WordPress app password</Label>
            <div className="relative">
              <Input
                id="site-wp-password"
                type={showPassword ? "text" : "password"}
                value={form.wp_app_password}
                onChange={(e) => setField("wp_app_password", e.target.value)}
                disabled={submitting}
                className="pr-16"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showPassword ? "hide" : "show"}
              </button>
            </div>
            <FieldError message={fieldErrors.wp_app_password} />
          </div>

          {formError && (
            <div
              className={cn(
                "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive",
              )}
              role="alert"
            >
              {formError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Registering…" : "Register site"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
