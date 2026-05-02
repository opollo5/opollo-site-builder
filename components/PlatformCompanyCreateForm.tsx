"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { H1, Lead } from "@/components/ui/typography";

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

// P3-2 — Form for creating a customer company. Operator-only — the API
// route gates on requireAdminForApi.
//
// Slug is optional in the form: leaving it blank lets the lib helper
// auto-generate a URL-safe slug from the name. Domain + timezone are
// also optional.

type FormState = {
  name: string;
  slug: string;
  domain: string;
  submitting: boolean;
  error: string | null;
};

const INITIAL: FormState = {
  name: "",
  slug: "",
  domain: "",
  submitting: false,
  error: null,
};

export function PlatformCompanyCreateForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(INITIAL);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setForm((s) => ({ ...s, submitting: true, error: null }));

    const body: Record<string, string | null> = { name: form.name.trim() };
    if (form.slug.trim()) body.slug = form.slug.trim();
    if (form.domain.trim()) body.domain = form.domain.trim();

    const response = await fetch("/api/admin/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await response.json().catch(() => null)) as {
      ok: boolean;
      error?: { code: string; message: string };
    } | null;

    if (!response.ok || !json?.ok) {
      setForm((s) => ({
        ...s,
        submitting: false,
        error: json?.error?.message ?? `Request failed (${response.status}).`,
      }));
      return;
    }

    router.push("/admin/companies");
    router.refresh();
  }

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <H1>New company</H1>
        <Lead className="mt-0.5">
          Create a customer company. The first admin will be invited
          separately from the company detail page (P3-4).
        </Lead>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="company-name">Name</Label>
          <Input
            id="company-name"
            data-testid="company-name"
            type="text"
            required
            maxLength={200}
            value={form.name}
            onChange={(e) =>
              setForm((s) => ({ ...s, name: e.target.value, error: null }))
            }
            disabled={form.submitting}
            placeholder="Skyview Technology"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="company-slug">Slug (optional)</Label>
          <Input
            id="company-slug"
            data-testid="company-slug"
            type="text"
            maxLength={60}
            value={form.slug}
            onChange={(e) =>
              setForm((s) => ({ ...s, slug: e.target.value, error: null }))
            }
            disabled={form.submitting}
            placeholder="auto-generated from name"
          />
          <p className="text-sm text-muted-foreground">
            URL-safe identifier. Leave blank to auto-generate from the
            name. Lowercase letters, digits, and hyphens only.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="company-domain">Domain (optional)</Label>
          <Input
            id="company-domain"
            data-testid="company-domain"
            type="text"
            maxLength={253}
            value={form.domain}
            onChange={(e) =>
              setForm((s) => ({ ...s, domain: e.target.value, error: null }))
            }
            disabled={form.submitting}
            placeholder="skyview.com"
          />
          <p className="text-sm text-muted-foreground">
            The customer&apos;s brand domain.
          </p>
        </div>

        {form.error ? (
          <div
            role="alert"
            data-testid="company-create-error"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {form.error}
          </div>
        ) : null}

        <div className="flex gap-2">
          <Button
            type="submit"
            data-testid="company-create-submit"
            disabled={form.submitting || !form.name.trim()}
          >
            {form.submitting ? "Creating…" : "Create company"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/admin/companies")}
            disabled={form.submitting}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
