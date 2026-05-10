"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { reportableToast } from "@/lib/error-reporting/reportable-toast";
import { toastSuccess } from "@/lib/toast-success";
import { Button } from "@/components/ui/button";
import { NavIcon } from "@/components/ui/nav-icon";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DbSettings {
  id?: string;
  color_pk?: string | null;
  color_pk2?: string | null;
  color_gr?: string | null;
  color_gr2?: string | null;
  color_bl?: string | null;
  color_am?: string | null;
  color_rd?: string | null;
  color_bg?: string | null;
  color_d1?: string | null;
  color_d2?: string | null;
  color_d3?: string | null;
  color_d4?: string | null;
  font_size_base?: string | null;
  font_size_xl?: string | null;
  font_display?: string | null;
  font_body?: string | null;
  radius_lg?: string | null;
  radius_full?: string | null;
}

type FieldKey = keyof Omit<DbSettings, "id">;

interface FieldSpec {
  key: FieldKey;
  label: string;
  type: "color" | "length" | "text";
  defaultValue: string;
  description?: string;
}

// ─── Default values (mirrors app/globals.css) ─────────────────────────────────

const DEFAULTS: Record<FieldKey, string> = {
  color_pk:       "#ff03a5",
  color_pk2:      "#cc0084",
  color_gr:       "#00e5a0",
  color_gr2:      "#00c48a",
  color_bl:       "#4da6ff",
  color_am:       "#ffb300",
  color_rd:       "#ff4d6d",
  color_bg:       "#04040a",
  color_d1:       "#07070f",
  color_d2:       "#0b0b18",
  color_d3:       "#10101e",
  color_d4:       "#161624",
  font_size_base: "1rem",
  font_size_xl:   "1.25rem",
  font_display:   "Fredoka",
  font_body:      "Manrope",
  radius_lg:      "0.5rem",
  radius_full:    "9999px",
};

// ─── Field definitions ────────────────────────────────────────────────────────

const FIELDS: FieldSpec[] = [
  // Colours
  { key: "color_pk",  label: "Pink (primary)",   type: "color",  defaultValue: DEFAULTS.color_pk,  description: "CTA buttons, active states, highlights" },
  { key: "color_pk2", label: "Pink (deep)",      type: "color",  defaultValue: DEFAULTS.color_pk2, description: "Button gradient end, hover accent" },
  { key: "color_gr",  label: "Green (primary)",  type: "color",  defaultValue: DEFAULTS.color_gr,  description: "Success, focus ring, eyebrow dashes, hover" },
  { key: "color_gr2", label: "Green (deep)",     type: "color",  defaultValue: DEFAULTS.color_gr2, description: "Green hover accent" },
  { key: "color_bl",  label: "Blue",             type: "color",  defaultValue: DEFAULTS.color_bl,  description: "Info states" },
  { key: "color_am",  label: "Amber",            type: "color",  defaultValue: DEFAULTS.color_am,  description: "Warning states" },
  { key: "color_rd",  label: "Red",              type: "color",  defaultValue: DEFAULTS.color_rd,  description: "Destructive actions, error states" },
  { key: "color_bg",  label: "Background base",  type: "color",  defaultValue: DEFAULTS.color_bg,  description: "Deepest background (canvas)" },
  { key: "color_d1",  label: "Surface 1",        type: "color",  defaultValue: DEFAULTS.color_d1,  description: "Card surface" },
  { key: "color_d2",  label: "Surface 2",        type: "color",  defaultValue: DEFAULTS.color_d2,  description: "Elevated surface" },
  { key: "color_d3",  label: "Surface 3",        type: "color",  defaultValue: DEFAULTS.color_d3,  description: "Muted / popover surface" },
  { key: "color_d4",  label: "Surface 4",        type: "color",  defaultValue: DEFAULTS.color_d4,  description: "Hover / secondary surface" },
  // Typography
  { key: "font_size_base", label: "Base font size", type: "length", defaultValue: DEFAULTS.font_size_base, description: "Body and UI text (minimum 1rem / 16px)" },
  { key: "font_size_xl",   label: "XL font size",   type: "length", defaultValue: DEFAULTS.font_size_xl,   description: "Page headings" },
  { key: "font_display",   label: "Display font",   type: "text",   defaultValue: DEFAULTS.font_display,   description: "Heading font family (Fredoka by default)" },
  { key: "font_body",      label: "Body font",      type: "text",   defaultValue: DEFAULTS.font_body,      description: "Body and UI font family (Manrope by default)" },
  // Geometry
  { key: "radius_lg",   label: "Border radius (base)", type: "length", defaultValue: DEFAULTS.radius_lg,   description: "Default card and input radius" },
  { key: "radius_full", label: "Border radius (pill)", type: "length", defaultValue: DEFAULTS.radius_full, description: "Button pill radius" },
];

// ─── Utility ─────────────────────────────────────────────────────────────────

function buildCssBlock(values: Partial<Record<FieldKey, string | null>>): string {
  const vars: string[] = [];
  if (values.color_pk)       vars.push(`--pk: ${values.color_pk};`);
  if (values.color_pk2)      vars.push(`--pk2: ${values.color_pk2};`);
  if (values.color_gr)       vars.push(`--gr: ${values.color_gr};`);
  if (values.color_gr2)      vars.push(`--gr2: ${values.color_gr2};`);
  if (values.color_bl)       vars.push(`--bl: ${values.color_bl};`);
  if (values.color_am)       vars.push(`--am: ${values.color_am};`);
  if (values.color_rd)       vars.push(`--rd: ${values.color_rd};`);
  if (values.color_bg)       vars.push(`--bg: ${values.color_bg};`);
  if (values.color_d1)       vars.push(`--d1: ${values.color_d1};`);
  if (values.color_d2)       vars.push(`--d2: ${values.color_d2};`);
  if (values.color_d3)       vars.push(`--d3: ${values.color_d3};`);
  if (values.color_d4)       vars.push(`--d4: ${values.color_d4};`);
  if (values.font_size_base) vars.push(`--font-size-base: ${values.font_size_base};`);
  if (values.font_size_xl)   vars.push(`--font-size-xl: ${values.font_size_xl};`);
  if (values.font_display)   vars.push(`--font-display: ${values.font_display};`);
  if (values.font_body)      vars.push(`--font-body: ${values.font_body};`);
  if (values.radius_lg)      vars.push(`--radius: ${values.radius_lg};`);
  if (values.radius_full)    vars.push(`--radius-full: ${values.radius_full};`);
  if (vars.length === 0) return "";
  return `:root { ${vars.join(" ")} }`;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  initialSettings: DbSettings | null;
}

export function DesignSystemSettingsClient({ initialSettings }: Props) {
  const [isPending, startTransition] = useTransition();
  const previewRef = useRef<HTMLIFrameElement>(null);

  const [values, setValues] = useState<Partial<Record<FieldKey, string | null>>>(
    initialSettings ?? {},
  );

  const isDirty = useRef(false);

  const applyLivePreview = useCallback(
    (current: Partial<Record<FieldKey, string | null>>) => {
      const doc = previewRef.current?.contentDocument;
      if (!doc) return;
      let styleEl = doc.getElementById("opollo-preview-vars") as HTMLStyleElement | null;
      if (!styleEl) {
        styleEl = doc.createElement("style");
        styleEl.id = "opollo-preview-vars";
        doc.head.appendChild(styleEl);
      }
      styleEl.textContent = buildCssBlock(current);
    },
    [],
  );

  function setValue(key: FieldKey, raw: string | null) {
    isDirty.current = true;
    setValues((prev) => ({ ...prev, [key]: raw || null }));
    applyLivePreview({ ...values, [key]: raw || null });
  }

  function handleSave() {
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/design-system-settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        });
        const json: { ok: boolean; error?: { message: string } } = await res.json();
        if (!json.ok) throw new Error(json.error?.message ?? "Save failed");
        isDirty.current = false;
        toastSuccess("Design system settings saved.");
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        reportableToast.error("Save failed", { message: errMsg }, { description: errMsg });
      }
    });
  }

  function handleReset() {
    const cleared: Partial<Record<FieldKey, null>> = {};
    for (const f of FIELDS) cleared[f.key] = null;
    setValues(cleared);
    applyLivePreview(cleared);
    isDirty.current = true;
  }

  function displayValue(key: FieldKey): string {
    return values[key] ?? DEFAULTS[key] ?? "";
  }

  // PageHeader (title + subtitle + breadcrumb) lives in
  // app/admin/settings/design-system/page.tsx via Spec 04 migration.
  // This component renders the action row + form below the header.
  return (
    <div className="space-y-8">
      <div className="flex items-start justify-end gap-4">
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            disabled={isPending}
            data-testid="ds-settings-reset"
          >
            <NavIcon name="undo" size={16} />
            Reset to defaults
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isPending} data-testid="ds-settings-save">
            <NavIcon name="floppy-disk" size={16} />
            {isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_400px]">
        {/* Left: token editor */}
        <div className="space-y-6">
          {/* Colours */}
          <section>
            <h2 className="font-display mb-3 text-base font-semibold">Colours</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {FIELDS.filter((f) => f.type === "color").map((f) => (
                <ColorField
                  key={f.key}
                  spec={f}
                  value={displayValue(f.key)}
                  isOverridden={values[f.key] != null}
                  onChange={(v) => setValue(f.key, v)}
                />
              ))}
            </div>
          </section>

          {/* Typography */}
          <section>
            <h2 className="font-display mb-3 text-base font-semibold">Typography</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {FIELDS.filter(
                (f) => (f.type === "length" || f.type === "text") && f.key.startsWith("font"),
              ).map((f) => (
                <TextField
                  key={f.key}
                  spec={f}
                  value={displayValue(f.key)}
                  isOverridden={values[f.key] != null}
                  onChange={(v) => setValue(f.key, v)}
                />
              ))}
            </div>
          </section>

          {/* Geometry */}
          <section>
            <h2 className="font-display mb-3 text-base font-semibold">Geometry</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {FIELDS.filter((f) => f.key.startsWith("radius")).map((f) => (
                <TextField
                  key={f.key}
                  spec={f}
                  value={displayValue(f.key)}
                  isOverridden={values[f.key] != null}
                  onChange={(v) => setValue(f.key, v)}
                />
              ))}
            </div>
          </section>
        </div>

        {/* Right: live preview */}
        <div className="self-start space-y-2 lg:sticky lg:top-8">
          <h2 className="font-display text-base font-semibold">Live preview</h2>
          <div className="overflow-hidden rounded-lg border border-border">
            <iframe
              ref={previewRef}
              title="Design system live preview"
              srcDoc={PREVIEW_HTML}
              className="h-[600px] w-full bg-white"
              onLoad={() => applyLivePreview(values)}
              sandbox="allow-same-origin"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Preview updates live. Save to apply globally.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface ColorFieldProps {
  spec: FieldSpec;
  value: string;
  isOverridden: boolean;
  onChange: (v: string) => void;
}

function ColorField({ spec, value, isOverridden, onChange }: ColorFieldProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
      <input
        type="color"
        value={value.startsWith("#") ? value : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
        aria-label={spec.label}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium leading-none">{spec.label}</span>
          {isOverridden && (
            <span className="rounded-sm bg-gr/10 px-1 py-0.5 text-xs font-medium text-gr">
              overridden
            </span>
          )}
        </div>
        {spec.description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{spec.description}</p>
        )}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1.5 w-full rounded border border-border bg-background px-2 py-1 font-mono text-xs"
          placeholder={DEFAULTS[spec.key]}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

interface TextFieldProps {
  spec: FieldSpec;
  value: string;
  isOverridden: boolean;
  onChange: (v: string) => void;
}

function TextField({ spec, value, isOverridden, onChange }: TextFieldProps) {
  return (
    <div className={cn("space-y-1.5 rounded-lg border border-border bg-card p-3")}>
      <div className="flex items-center gap-1.5">
        <label className="text-sm font-medium leading-none">{spec.label}</label>
        {isOverridden && (
          <span className="rounded-sm bg-gr/10 px-1 py-0.5 text-xs font-medium text-gr">
            overridden
          </span>
        )}
      </div>
      {spec.description && (
        <p className="text-xs text-muted-foreground">{spec.description}</p>
      )}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-sm"
        placeholder={DEFAULTS[spec.key]}
        spellCheck={false}
      />
    </div>
  );
}

// ─── Preview HTML ─────────────────────────────────────────────────────────────

const PREVIEW_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
:root {
  --pk: #ff03a5; --pk2: #cc0084;
  --gr: #00e5a0; --gr2: #00c48a;
  --bl: #4da6ff; --am: #ffb300; --rd: #ff4d6d;
  --bg: #04040a; --d1: #07070f; --d2: #0b0b18; --d3: #10101e; --d4: #161624;
  --m1: rgba(255,255,255,0.92); --m2: rgba(255,255,255,0.58);
  --b1: rgba(255,255,255,0.06); --b2: rgba(255,255,255,0.12); --b3: rgba(255,255,255,0.20);
  --font-size-base: 1rem; --font-size-xl: 1.25rem;
  --font-display: Sora, sans-serif; --font-body: Inter, sans-serif;
  --radius: 0.5rem; --radius-full: 9999px;
}
*, *::before, *::after { box-sizing: border-box; }
body {
  background: var(--bg);
  color: var(--m1);
  font-family: var(--font-body);
  font-size: var(--font-size-base);
  margin: 0;
  padding: 20px;
}
h1, h2, h3 { font-family: var(--font-display); font-weight: 600; letter-spacing: -0.02em; }
.preview-card {
  background: var(--d1);
  border: 1px solid var(--b1);
  border-radius: var(--radius);
  padding: 20px;
  margin-bottom: 16px;
}
.btn-pk {
  background: linear-gradient(135deg, var(--pk), var(--pk2));
  color: #fff;
  border: none;
  border-radius: var(--radius-full);
  font-family: inherit;
  font-size: var(--font-size-base);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 10px 24px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
}
.btn-ghost {
  background: transparent;
  color: var(--m1);
  border: 1px solid var(--b3);
  border-radius: var(--radius-full);
  font-family: inherit;
  font-size: var(--font-size-base);
  font-weight: 600;
  padding: 10px 24px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
}
.lbl {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 0.875rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.20em; color: var(--gr);
}
.lbl::before { content: '\\2014'; color: var(--gr); font-weight: 700; }
.pk { color: var(--pk); }
.badge-success { background: rgba(0,229,160,0.12); color: var(--gr); border-radius: 4px; padding: 2px 8px; font-size: 0.875rem; }
.badge-warn { background: rgba(255,179,0,0.12); color: var(--am); border-radius: 4px; padding: 2px 8px; font-size: 0.875rem; }
.badge-error { background: rgba(255,77,109,0.12); color: var(--rd); border-radius: 4px; padding: 2px 8px; font-size: 0.875rem; }
.input-field {
  background: var(--d2); border: 1px solid var(--b2); border-radius: var(--radius);
  color: var(--m1); font-family: inherit; font-size: var(--font-size-base);
  padding: 8px 12px; width: 100%; outline: none;
}
.input-field:focus { border-color: var(--gr); }
.swatch-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.swatch { width: 32px; height: 32px; border-radius: var(--radius); border: 1px solid var(--b2); }
</style>
</head>
<body>
<div class="preview-card">
  <span class="lbl">Design system</span>
  <h1 style="font-size:var(--font-size-xl);margin:8px 0;">Opollo <span class="pk">preview</span></h1>
  <p style="color:var(--m2);margin:0 0 16px 0;">Live preview updates as you change tokens above.</p>
  <div style="display:flex;gap:8px;flex-wrap:wrap;">
    <button class="btn-pk">Save changes</button>
    <button class="btn-ghost">Cancel</button>
  </div>
</div>
<div class="preview-card">
  <h2 style="font-size:var(--font-size-base);margin:0 0 12px 0;">Status badges</h2>
  <div style="display:flex;gap:8px;flex-wrap:wrap;">
    <span class="badge-success">Active</span>
    <span class="badge-warn">Pending</span>
    <span class="badge-error">Failed</span>
  </div>
</div>
<div class="preview-card">
  <h2 style="font-size:var(--font-size-base);margin:0 0 12px 0;">Form input</h2>
  <input class="input-field" placeholder="e.g. https://example.com" />
</div>
<div class="preview-card">
  <h2 style="font-size:var(--font-size-base);margin:0 0 4px 0;">Colour palette</h2>
  <div class="swatch-row">
    <div class="swatch" style="background:var(--pk)" title="--pk"></div>
    <div class="swatch" style="background:var(--pk2)" title="--pk2"></div>
    <div class="swatch" style="background:var(--gr)" title="--gr"></div>
    <div class="swatch" style="background:var(--bl)" title="--bl"></div>
    <div class="swatch" style="background:var(--am)" title="--am"></div>
    <div class="swatch" style="background:var(--rd)" title="--rd"></div>
    <div class="swatch" style="background:var(--d1);border-color:var(--b3)" title="--d1"></div>
    <div class="swatch" style="background:var(--d2);border-color:var(--b3)" title="--d2"></div>
    <div class="swatch" style="background:var(--d3);border-color:var(--b3)" title="--d3"></div>
    <div class="swatch" style="background:var(--d4);border-color:var(--b3)" title="--d4"></div>
  </div>
</div>
</body>
</html>`;
