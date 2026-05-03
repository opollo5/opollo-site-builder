"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eyebrow, H1, Lead } from "@/components/ui/typography";
// Value imports come directly from the sub-path. Importing them from
// the `@/lib/platform/brand` barrel would pull `./get` and `./update`
// (both `import "server-only"`) into the client bundle via the
// barrel's re-exports — even mixed-syntax `import { type X, value }`
// triggers module evaluation — and the build fails with
// "You're importing a component that needs server-only".
// Types are still routed through the barrel because `import type`
// erases at build time and never triggers module evaluation.
import {
  brandTierDescription,
  brandTierLabel,
  getBrandTier,
} from "@/lib/platform/brand/completion";
import type {
  BrandFormality,
  BrandPov,
  BrandProfile,
} from "@/lib/platform/brand";
import type { PlatformCompany } from "@/lib/platform/companies";

// P-Brand-1c — client-side edit form for the active brand profile.
// Backend half (PATCH /api/platform/brand) shipped in P-Brand-1b.
//
// Scope of this slice: the visual-identity + tone-basics fields the
// downstream products (image generation, CAP) read first. Logos, voice
// examples, image_style JSONB, platform_overrides, all the array
// fields, content_restrictions (staff-only) — those land in follow-ups.
//
// Submits the diff (only the fields the operator changed) so the RPC's
// COALESCE-against-current preserves untouched data. On success, calls
// router.refresh() so the server-rendered page re-reads the new active
// version.

type Props = {
  company: PlatformCompany;
  brand: BrandProfile | null;
};

export type FormState = {
  primary_colour: string;
  secondary_colour: string;
  accent_colour: string;
  heading_font: string;
  body_font: string;
  formality: BrandFormality | "";
  point_of_view: BrandPov | "";
  industry: string;
  safe_mode: boolean;
  change_summary: string;
  submitting: boolean;
  error: string | null;
  success: string | null;
};

function initialState(brand: BrandProfile | null): FormState {
  return {
    primary_colour: brand?.primary_colour ?? "",
    secondary_colour: brand?.secondary_colour ?? "",
    accent_colour: brand?.accent_colour ?? "",
    heading_font: brand?.heading_font ?? "",
    body_font: brand?.body_font ?? "",
    formality: brand?.formality ?? "",
    point_of_view: brand?.point_of_view ?? "",
    industry: brand?.industry ?? "",
    safe_mode: brand?.safe_mode ?? false,
    change_summary: "",
    submitting: false,
    error: null,
    success: null,
  };
}

// Build the patch payload — only include fields whose value differs
// from the current brand. Empty string is sent as null (operator
// clearing a value); unchanged fields are dropped from the patch.
// Exported for unit tests; the component is the only runtime caller.
export function buildPatch(
  state: FormState,
  brand: BrandProfile | null,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  function diff<K extends keyof BrandProfile>(
    key: K,
    formValue: string | boolean,
  ): void {
    const formNormalised =
      typeof formValue === "string" ? formValue.trim() : formValue;
    const formForCompare =
      formNormalised === "" ? null : formNormalised;
    const currentValue = brand?.[key] ?? null;
    if (formForCompare !== currentValue) {
      patch[key] = formForCompare;
    }
  }

  diff("primary_colour", state.primary_colour);
  diff("secondary_colour", state.secondary_colour);
  diff("accent_colour", state.accent_colour);
  diff("heading_font", state.heading_font);
  diff("body_font", state.body_font);
  diff("industry", state.industry);
  diff("formality", state.formality);
  diff("point_of_view", state.point_of_view);
  if ((brand?.safe_mode ?? false) !== state.safe_mode) {
    patch.safe_mode = state.safe_mode;
  }

  return patch;
}

export function CustomerBrandProfileEditor({ company, brand }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => initialState(brand));

  const tier = getBrandTier(brand);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setForm((s) => ({ ...s, submitting: true, error: null, success: null }));

    const patch = buildPatch(form, brand);
    if (Object.keys(patch).length === 0) {
      setForm((s) => ({
        ...s,
        submitting: false,
        error: "No changes to save.",
      }));
      return;
    }

    const url = `/api/platform/brand?company_id=${encodeURIComponent(company.id)}`;
    const response = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: patch,
        change_summary: form.change_summary.trim() || null,
      }),
    });
    const json = (await response.json().catch(() => null)) as {
      ok: boolean;
      data?: { brand: BrandProfile; created: boolean };
      error?: { code: string; message: string };
    } | null;

    if (!response.ok || !json?.ok || !json.data) {
      setForm((s) => ({
        ...s,
        submitting: false,
        error: json?.error?.message ?? `Request failed (${response.status}).`,
      }));
      return;
    }

    setForm((s) => ({
      ...s,
      submitting: false,
      success: json.data!.created
        ? "Brand profile created."
        : `Saved as version ${json.data!.brand.version}.`,
      change_summary: "",
    }));
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <header>
        <H1>Brand profile</H1>
        <Lead className="mt-1">
          How <strong>{company.name}</strong> looks, sounds, and behaves
          across every Opollo product.
        </Lead>
      </header>

      <section
        className="rounded-lg border bg-card p-4"
        aria-labelledby="tier-summary"
      >
        <Eyebrow id="tier-summary">Setup</Eyebrow>
        <h2 className="mt-1 text-base font-semibold">{brandTierLabel(tier)}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {brandTierDescription(tier)}
        </p>
        {brand ? (
          <div className="mt-2 text-sm text-muted-foreground">
            Version {brand.version} · Updated {formatDate(brand.updated_at)}
            {brand.safe_mode ? " · Safe mode on" : ""}
          </div>
        ) : null}
      </section>

      <form
        onSubmit={handleSubmit}
        className="space-y-6"
        data-testid="brand-editor-form"
      >
        <section
          className="rounded-lg border bg-card"
          aria-labelledby="visual-identity-heading"
        >
          <header className="border-b px-4 py-3">
            <h2 id="visual-identity-heading" className="text-base font-semibold">
              Visual identity
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Colours and fonts. Image generation and compositing read these
              for every output.
            </p>
          </header>
          <div className="grid gap-4 p-4 md:grid-cols-2">
            <ColourField
              id="primary_colour"
              label="Primary colour"
              value={form.primary_colour}
              onChange={(v) => setForm((s) => ({ ...s, primary_colour: v }))}
              disabled={form.submitting}
            />
            <ColourField
              id="secondary_colour"
              label="Secondary colour"
              value={form.secondary_colour}
              onChange={(v) => setForm((s) => ({ ...s, secondary_colour: v }))}
              disabled={form.submitting}
            />
            <ColourField
              id="accent_colour"
              label="Accent colour"
              value={form.accent_colour}
              onChange={(v) => setForm((s) => ({ ...s, accent_colour: v }))}
              disabled={form.submitting}
            />
            <TextField
              id="heading_font"
              label="Heading font"
              placeholder="e.g. EmBauhausW00"
              value={form.heading_font}
              onChange={(v) => setForm((s) => ({ ...s, heading_font: v }))}
              disabled={form.submitting}
            />
            <TextField
              id="body_font"
              label="Body font"
              placeholder="e.g. Inter"
              value={form.body_font}
              onChange={(v) => setForm((s) => ({ ...s, body_font: v }))}
              disabled={form.submitting}
            />
            <ToggleField
              id="safe_mode"
              label="Safe mode"
              description="Blocks bold/editorial styles in image generation; falls back to stock first."
              checked={form.safe_mode}
              onChange={(v) => setForm((s) => ({ ...s, safe_mode: v }))}
              disabled={form.submitting}
            />
          </div>
        </section>

        <section
          className="rounded-lg border bg-card"
          aria-labelledby="tone-heading"
        >
          <header className="border-b px-4 py-3">
            <h2 id="tone-heading" className="text-base font-semibold">
              Tone of voice
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The basics. Personality traits, voice examples, and platform
              overrides land in a follow-up.
            </p>
          </header>
          <div className="grid gap-4 p-4 md:grid-cols-2">
            <TextField
              id="industry"
              label="Industry"
              placeholder="e.g. Technology / SaaS"
              value={form.industry}
              onChange={(v) => setForm((s) => ({ ...s, industry: v }))}
              disabled={form.submitting}
            />
            <SelectField
              id="formality"
              label="Formality"
              value={form.formality}
              onChange={(v) =>
                setForm((s) => ({ ...s, formality: v as BrandFormality | "" }))
              }
              options={[
                { value: "", label: "—" },
                { value: "formal", label: "Formal" },
                { value: "semi_formal", label: "Semi-formal" },
                { value: "casual", label: "Casual" },
              ]}
              disabled={form.submitting}
            />
            <SelectField
              id="point_of_view"
              label="Point of view"
              value={form.point_of_view}
              onChange={(v) =>
                setForm((s) => ({ ...s, point_of_view: v as BrandPov | "" }))
              }
              options={[
                { value: "", label: "—" },
                { value: "first_person", label: "First person (we)" },
                { value: "third_person", label: "Third person" },
              ]}
              disabled={form.submitting}
            />
          </div>
        </section>

        <section className="rounded-lg border bg-card p-4">
          <label htmlFor="change_summary" className="block text-sm font-medium">
            What changed (optional)
          </label>
          <Input
            id="change_summary"
            type="text"
            placeholder="e.g. Updated brand colours after Q2 refresh"
            className="mt-1"
            maxLength={500}
            value={form.change_summary}
            onChange={(e) =>
              setForm((s) => ({ ...s, change_summary: e.target.value }))
            }
            disabled={form.submitting}
          />
          <p className="mt-1 text-sm text-muted-foreground">
            Saved with the version history.
          </p>
        </section>

        {form.error ? (
          <div
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            role="alert"
            data-testid="brand-editor-error"
          >
            {form.error}
          </div>
        ) : null}

        {form.success ? (
          <div
            className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900"
            role="status"
            data-testid="brand-editor-success"
          >
            {form.success}
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <Button
            type="submit"
            disabled={form.submitting}
            data-testid="brand-editor-submit"
          >
            {form.submitting ? "Saving…" : brand ? "Save changes" : "Create profile"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  placeholder,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        type="text"
        className="mt-1"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </div>
  );
}

function ColourField({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <div className="mt-1 flex items-center gap-2">
        <Input
          id={id}
          type="text"
          placeholder="#FF03A5"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono"
          disabled={disabled}
        />
        <span
          aria-hidden
          className="inline-block h-9 w-9 shrink-0 rounded-md border"
          style={{ backgroundColor: value || "transparent" }}
        />
      </div>
    </div>
  );
}

function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ToggleField({
  id,
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        className="mt-1 h-4 w-4"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <div>
        <label htmlFor={id} className="block text-sm font-medium">
          {label}
        </label>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
