"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ThemeOverrides } from "@/lib/platform/theming/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Company {
  id: string;
  name: string;
}

interface Props {
  companies: Company[];
  selectedCompanyId: string | null;
  initialOverrides: ThemeOverrides;
  updatedAt: string | null;
  updatedByEmail: string | null;
}

// ---------------------------------------------------------------------------
// WCAG contrast helpers (inline — no dependency)
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] | null {
  const cleaned = hex.replace("#", "");
  if (cleaned.length !== 6) return null;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return [r, g, b];
}

function relativeLuminance(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hex1: string, hex2: string): number | null {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  if (l1 === null || l2 === null) return null;
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Token field config
// ---------------------------------------------------------------------------

interface TokenGroup {
  label: string;
  tokens: Array<{
    key: keyof ThemeOverrides;
    label: string;
    placeholder: string;
    hint: string;
  }>;
  /** Pairs [bg, fg] to check contrast for each group. */
  contrastPair?: [keyof ThemeOverrides, keyof ThemeOverrides];
}

const TOKEN_GROUPS: TokenGroup[] = [
  {
    label: "Brand",
    tokens: [
      {
        key: "--primary",
        label: "Primary CTA colour",
        placeholder: "hsl(142 76% 36%)",
        hint: "Controls buttons, links, and primary actions.",
      },
    ],
  },
  {
    label: "Success",
    tokens: [
      {
        key: "--color-success-bg",
        label: "Success background",
        placeholder: "#ECFDF5",
        hint: "",
      },
      {
        key: "--color-success-fg",
        label: "Success foreground",
        placeholder: "#065F46",
        hint: "",
      },
      {
        key: "--color-success-border",
        label: "Success border",
        placeholder: "#A7F3D0",
        hint: "",
      },
    ],
    contrastPair: ["--color-success-bg", "--color-success-fg"],
  },
  {
    label: "Warning",
    tokens: [
      {
        key: "--color-warning-bg",
        label: "Warning background",
        placeholder: "#FFFBEB",
        hint: "",
      },
      {
        key: "--color-warning-fg",
        label: "Warning foreground",
        placeholder: "#92400E",
        hint: "",
      },
      {
        key: "--color-warning-border",
        label: "Warning border",
        placeholder: "#FDE68A",
        hint: "",
      },
    ],
    contrastPair: ["--color-warning-bg", "--color-warning-fg"],
  },
  {
    label: "Danger",
    tokens: [
      {
        key: "--color-danger-bg",
        label: "Danger background",
        placeholder: "#FEF2F2",
        hint: "",
      },
      {
        key: "--color-danger-fg",
        label: "Danger foreground",
        placeholder: "#991B1B",
        hint: "",
      },
      {
        key: "--color-danger-border",
        label: "Danger border",
        placeholder: "#FECACA",
        hint: "",
      },
    ],
    contrastPair: ["--color-danger-bg", "--color-danger-fg"],
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ThemingClient({
  companies,
  selectedCompanyId,
  initialOverrides,
  updatedAt,
  updatedByEmail,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [overrides, setOverrides] = useState<ThemeOverrides>(initialOverrides);
  const [saving, setSaving] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  function handleCompanyChange(e: React.ChangeEvent<HTMLSelectElement>) {
    startTransition(() => {
      router.push(`/admin/theming?company=${e.target.value}`);
    });
  }

  function handleTokenChange(key: keyof ThemeOverrides, value: string) {
    setOverrides((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!selectedCompanyId) return;
    setSaving(true);
    setToast(null);
    try {
      const res = await fetch(`/api/admin/theming/${selectedCompanyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(overrides),
      });
      if (!res.ok) throw new Error((await res.json() as { error?: string }).error ?? "Save failed");
      setToast({ type: "success", msg: "Theme saved." });
      router.refresh();
    } catch (err) {
      setToast({ type: "error", msg: String(err) });
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!selectedCompanyId) return;
    setResetPending(true);
    setToast(null);
    try {
      const res = await fetch(`/api/admin/theming/${selectedCompanyId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Reset failed");
      setOverrides({});
      setToast({ type: "success", msg: "Reset to defaults." });
      router.refresh();
    } catch (err) {
      setToast({ type: "error", msg: String(err) });
    } finally {
      setResetPending(false);
    }
  }

  // Build live preview CSS string from current edited values.
  const previewCss = Object.entries(overrides)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v};`)
    .join(" ");

  return (
    <div className="mt-6 space-y-6">
      {/* Company selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Company</CardTitle>
          <CardDescription>Select a company to edit its theme.</CardDescription>
        </CardHeader>
        <CardContent>
          <select
            className="h-10 w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={selectedCompanyId ?? ""}
            onChange={handleCompanyChange}
            disabled={isPending}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {updatedAt && (
            <p className="mt-2 text-xs text-muted-foreground">
              Last updated{updatedByEmail ? ` by ${updatedByEmail}` : ""} at{" "}
              {new Date(updatedAt).toLocaleString()}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Token groups */}
      {TOKEN_GROUPS.map((group) => {
        const contrastWarning = group.contrastPair
          ? (() => {
              const [bgKey, fgKey] = group.contrastPair;
              const bg = overrides[bgKey] ?? "";
              const fg = overrides[fgKey] ?? "";
              if (!bg || !fg) return null;
              const ratio = contrastRatio(bg, fg);
              if (ratio === null || ratio >= 4.5) return null;
              return `Contrast ratio ${ratio.toFixed(2)}:1 is below 4.5:1 (WCAG AA). You can still save.`;
            })()
          : null;

        return (
          <Card key={group.label}>
            <CardHeader>
              <CardTitle className="text-base">{group.label}</CardTitle>
              {contrastWarning && (
                <p className="text-xs font-medium text-amber-600">{contrastWarning}</p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {group.tokens.map(({ key, label, placeholder, hint }) => (
                <div key={key} className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor={`token-${key}`}>
                    {label}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{key}</span>
                  </label>
                  <div className="flex items-center gap-2">
                    {/* Colour preview swatch */}
                    {overrides[key] && (
                      <div
                        className="h-7 w-7 shrink-0 rounded border border-border"
                        style={{ background: overrides[key] }}
                        title={overrides[key]}
                      />
                    )}
                    <Input
                      id={`token-${key}`}
                      value={overrides[key] ?? ""}
                      onChange={(e) => handleTokenChange(key, e.target.value)}
                      placeholder={placeholder}
                      className="font-mono"
                    />
                  </div>
                  {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}

      {/* Radius */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Border radius</CardTitle>
          <CardDescription>
            Sets the base radius scale (e.g. <code>0.5rem</code>). Tailwind maps
            sm/md/lg/xl from this value.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="token-radius">
              Radius
              <span className="ml-2 font-mono text-xs text-muted-foreground">--radius</span>
            </label>
            <Input
              id="token-radius"
              value={overrides["--radius"] ?? ""}
              onChange={(e) => handleTokenChange("--radius", e.target.value)}
              placeholder="0.5rem"
              className="max-w-xs font-mono"
            />
          </div>
        </CardContent>
      </Card>

      {/* Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preview</CardTitle>
          <CardDescription>
            Live preview using the values above. Reflects edits before save.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Inline style injects overrides into this scope only */}
          <div style={previewCss ? ({ ["--preview-scope"]: "1" } as React.CSSProperties) : {}}>
            <style>{previewCss ? `:root { ${previewCss} }` : ""}</style>
            <div className="space-y-3">
              {/* Swatch row */}
              <div className="flex flex-wrap gap-2">
                <div
                  className="flex h-10 w-24 items-center justify-center rounded-md text-xs font-medium"
                  style={{ background: overrides["--color-success-bg"] ?? "var(--color-success-bg)", color: overrides["--color-success-fg"] ?? "var(--color-success-fg)" }}
                >
                  Success
                </div>
                <div
                  className="flex h-10 w-24 items-center justify-center rounded-md text-xs font-medium"
                  style={{ background: overrides["--color-warning-bg"] ?? "var(--color-warning-bg)", color: overrides["--color-warning-fg"] ?? "var(--color-warning-fg)" }}
                >
                  Warning
                </div>
                <div
                  className="flex h-10 w-24 items-center justify-center rounded-md text-xs font-medium"
                  style={{ background: overrides["--color-danger-bg"] ?? "var(--color-danger-bg)", color: overrides["--color-danger-fg"] ?? "var(--color-danger-fg)" }}
                >
                  Danger
                </div>
              </div>

              {/* Sample buttons */}
              <div className="flex flex-wrap gap-2">
                <Button size="sm">Primary action</Button>
                <Button size="sm" variant="outline">Secondary</Button>
                <Button size="sm" variant="destructive">Destructive</Button>
              </div>

              {/* Sample status banner */}
              <div
                className="rounded-md border px-4 py-2 text-sm"
                style={{
                  background: overrides["--color-success-bg"] ?? "var(--color-success-bg)",
                  borderColor: overrides["--color-success-border"] ?? "var(--color-success-border)",
                  color: overrides["--color-success-fg"] ?? "var(--color-success-fg)",
                }}
              >
                Connected — your integration is working correctly.
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Toast */}
      {toast && (
        <div
          className={
            toast.type === "success"
              ? "rounded-md border border-[--color-success-border] bg-[--color-success-bg] px-4 py-2 text-sm text-[--color-success-fg]"
              : "rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive"
          }
        >
          {toast.msg}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving || !selectedCompanyId}>
          {saving ? "Saving…" : "Save theme"}
        </Button>
        <Button
          variant="outline"
          onClick={handleReset}
          disabled={resetPending || !selectedCompanyId}
        >
          {resetPending ? "Resetting…" : "Reset to defaults"}
        </Button>
      </div>
    </div>
  );
}
