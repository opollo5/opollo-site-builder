"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type LayoutDensity = "compact" | "medium" | "spacious";

type ExtractedDesign = {
  colors: {
    primary: string | null;
    secondary: string | null;
    accent: string | null;
    background: string | null;
    text: string | null;
  };
  fonts: { heading: string | null; body: string | null };
  layout_density: LayoutDensity;
  visual_tone: string;
  screenshot_url: string | null;
  source_pages: string[];
};

type ExtractedCssClasses = {
  container: string | null;
  headings: { h1: string | null; h2: string | null; h3: string | null };
  button: string | null;
  card: string | null;
};

type ExtractionResponse = {
  ok: boolean;
  design: ExtractedDesign;
  css_classes: ExtractedCssClasses;
  notes: string[];
};

const EMPTY_DESIGN: ExtractedDesign = {
  colors: { primary: null, secondary: null, accent: null, background: null, text: null },
  fonts: { heading: null, body: null },
  layout_density: "medium",
  visual_tone: "Neutral",
  screenshot_url: null,
  source_pages: [],
};

const EMPTY_CLASSES: ExtractedCssClasses = {
  container: null,
  headings: { h1: null, h2: null, h3: null },
  button: null,
  card: null,
};

function isExtractedDesign(value: unknown): value is ExtractedDesign {
  if (!value || typeof value !== "object") return false;
  return "colors" in value && "fonts" in value;
}

function isExtractedCssClasses(value: unknown): value is ExtractedCssClasses {
  if (!value || typeof value !== "object") return false;
  return "headings" in value;
}

export function CopyExistingExtractionWizard({
  siteId,
  siteUrl,
  existingDesign,
  existingClasses,
}: {
  siteId: string;
  siteUrl: string;
  existingDesign: unknown;
  existingClasses: unknown;
}) {
  const router = useRouter();
  const seededDesign = isExtractedDesign(existingDesign) ? existingDesign : null;
  const seededClasses = isExtractedCssClasses(existingClasses) ? existingClasses : null;
  const [design, setDesign] = useState<ExtractedDesign>(seededDesign ?? EMPTY_DESIGN);
  const [cssClasses, setCssClasses] = useState<ExtractedCssClasses>(
    seededClasses ?? EMPTY_CLASSES,
  );
  const [hasResults, setHasResults] = useState(seededDesign !== null);
  const [notes, setNotes] = useState<string[]>([]);
  const [extraPagesText, setExtraPagesText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  function parseExtraPages(text: string): string[] {
    return text
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 5);
  }

  async function runExtraction() {
    setExtracting(true);
    setError(null);
    setNotes([]);
    try {
      const res = await fetch(`/api/admin/sites/${siteId}/setup/extract`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          extra_pages: parseExtraPages(extraPagesText),
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { ok: true; data: ExtractionResponse }
        | { ok: false; error: { code: string; message: string } }
        | null;
      if (!res.ok || !payload?.ok) {
        setError(
          payload && payload.ok === false
            ? payload.error.message
            : `Extraction failed (HTTP ${res.status}).`,
        );
        return;
      }
      const result = payload.data;
      setDesign(result.design);
      setCssClasses(result.css_classes);
      setHasResults(true);
      setNotes(result.notes);
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExtracting(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sites/${siteId}/setup/extract/save`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          extracted_design: design,
          extracted_css_classes: cssClasses,
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { ok: true; data: { site_id: string } }
        | { ok: false; error: { code: string; message: string } }
        | null;
      if (!res.ok || !payload?.ok) {
        setError(
          payload && payload.ok === false
            ? payload.error.message
            : `Save failed (HTTP ${res.status}).`,
        );
        return;
      }
      setSavedAt(new Date().toLocaleTimeString());
      router.replace(`/admin/sites/${siteId}`);
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  function setColor(key: keyof ExtractedDesign["colors"], value: string) {
    setDesign((prev) => ({ ...prev, colors: { ...prev.colors, [key]: value || null } }));
  }
  function setFont(key: "heading" | "body", value: string) {
    setDesign((prev) => ({ ...prev, fonts: { ...prev.fonts, [key]: value || null } }));
  }
  function setHeadingClass(level: "h1" | "h2" | "h3", value: string) {
    setCssClasses((prev) => ({
      ...prev,
      headings: { ...prev.headings, [level]: value || null },
    }));
  }

  return (
    <div className="mt-6 space-y-6" data-testid="copy-existing-wizard">
      <section className="rounded-md border bg-muted/20 p-4">
        <h2 className="text-sm font-semibold">1 · Run extraction</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Source URL: <code>{siteUrl}</code>
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <label className="text-sm text-muted-foreground">
            Extra pages (optional, one URL per line)
            <textarea
              value={extraPagesText}
              onChange={(e) => setExtraPagesText(e.target.value)}
              placeholder={`https://example.com/about\nhttps://example.com/services\nhttps://example.com/contact`}
              rows={6}
              className="mt-1 min-h-[160px] w-full resize-y rounded border bg-background px-2 py-1 text-sm"
              disabled={extracting}
            />
          </label>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={() => void runExtraction()}
              disabled={extracting}
              data-testid="copy-existing-extract-run"
            >
              {extracting ? "Extracting…" : hasResults ? "Re-extract" : "Run extraction"}
            </Button>
            {notes.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {notes.join(" ")}
              </p>
            )}
          </div>
        </div>
      </section>

      {hasResults && (
        <section
          className="rounded-md border bg-background p-4"
          data-testid="copy-existing-design-profile"
        >
          <h2 className="text-sm font-semibold">2 · Review the design profile</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tweak any extracted value that looks wrong. Empty fields land as
            null and the generation prompt falls back to the site theme.
          </p>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                Colours
              </h3>
              {(["primary", "secondary", "accent", "background", "text"] as const).map(
                (key) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <span className="w-24 capitalize text-muted-foreground">{key}</span>
                    <span
                      className="h-5 w-5 shrink-0 rounded border"
                      style={{
                        backgroundColor: design.colors[key] ?? "transparent",
                      }}
                      aria-hidden
                    />
                    <input
                      type="text"
                      value={design.colors[key] ?? ""}
                      onChange={(e) => setColor(key, e.target.value)}
                      placeholder="#000000"
                      className="flex-1 rounded border bg-background px-2 py-1 text-sm"
                      data-testid={`copy-existing-color-${key}`}
                    />
                  </label>
                ),
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                Fonts
              </h3>
              {(["heading", "body"] as const).map((key) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <span className="w-24 capitalize text-muted-foreground">{key}</span>
                  <input
                    type="text"
                    value={design.fonts[key] ?? ""}
                    onChange={(e) => setFont(key, e.target.value)}
                    placeholder="Inter"
                    className="flex-1 rounded border bg-background px-2 py-1 text-sm"
                    style={{ fontFamily: design.fonts[key] ?? undefined }}
                  />
                </label>
              ))}

              <h3 className="mt-4 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                Tone
              </h3>
              <label className="flex items-center gap-2 text-sm">
                <span className="w-24 text-muted-foreground">Density</span>
                <select
                  value={design.layout_density}
                  onChange={(e) =>
                    setDesign((prev) => ({
                      ...prev,
                      layout_density: e.target.value as LayoutDensity,
                    }))
                  }
                  className="flex-1 rounded border bg-background px-2 py-1 text-sm"
                >
                  <option value="compact">Compact</option>
                  <option value="medium">Medium</option>
                  <option value="spacious">Spacious</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <span className="w-24 text-muted-foreground">Visual tone</span>
                <input
                  type="text"
                  value={design.visual_tone}
                  onChange={(e) =>
                    setDesign((prev) => ({ ...prev, visual_tone: e.target.value }))
                  }
                  className="flex-1 rounded border bg-background px-2 py-1 text-sm"
                />
              </label>
            </div>
          </div>

          <div className="mt-6">
            <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Detected CSS classes
            </h3>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <ClassInput
                label="Container"
                value={cssClasses.container}
                onChange={(v) =>
                  setCssClasses((prev) => ({ ...prev, container: v || null }))
                }
              />
              <ClassInput
                label="Button"
                value={cssClasses.button}
                onChange={(v) =>
                  setCssClasses((prev) => ({ ...prev, button: v || null }))
                }
              />
              <ClassInput
                label="Card"
                value={cssClasses.card}
                onChange={(v) =>
                  setCssClasses((prev) => ({ ...prev, card: v || null }))
                }
              />
              {(["h1", "h2", "h3"] as const).map((lvl) => (
                <ClassInput
                  key={lvl}
                  label={`${lvl.toUpperCase()}`}
                  value={cssClasses.headings[lvl]}
                  onChange={(v) => setHeadingClass(lvl, v)}
                />
              ))}
            </div>
          </div>

          {design.screenshot_url && (
            <div className="mt-6">
              <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                Site snapshot
              </h3>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={design.screenshot_url}
                alt="Site screenshot"
                className="mt-2 max-h-64 rounded border"
              />
            </div>
          )}
        </section>
      )}

      {error && (
        <Alert variant="destructive" title="Couldn't complete that step">
          {error}
        </Alert>
      )}

      {hasResults && (
        <div className="flex items-center justify-end gap-3">
          {savedAt && (
            <span className="text-sm text-muted-foreground">Saved at {savedAt}</span>
          )}
          <Button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            data-testid="copy-existing-save"
          >
            {saving ? "Saving…" : "Save design profile"}
          </Button>
        </div>
      )}
    </div>
  );
}

function ClassInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (next: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="w-24 text-muted-foreground">{label}</span>
      <input
        type="text"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder="(none detected)"
        className="flex-1 rounded border bg-background px-2 py-1 font-mono text-sm"
        data-testid={`copy-existing-class-${label.toLowerCase()}`}
      />
    </label>
  );
}
