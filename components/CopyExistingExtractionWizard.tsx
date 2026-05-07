"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/utils";

type LayoutDensity = "compact" | "medium" | "spacious";

type BlogStyling = {
  source_blog_urls: string[];
  article_container: string | null;
  paragraph: string | null;
  link_in_body: string | null;
  blockquote: string | null;
  unordered_list: string | null;
  ordered_list: string | null;
  list_item: string | null;
  figure: string | null;
  figcaption: string | null;
  code_inline: string | null;
  code_block: string | null;
  hr: string | null;
  article_h2: string | null;
  article_h3: string | null;
  article_h4: string | null;
  notes: string[];
  extracted_at: string;
};

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
  blog_styling?: BlogStyling | null;
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
  blog_styling: null,
};

const BLOG_STYLING_BUCKETS = [
  { group: "Container", keys: ["article_container"] as const },
  { group: "Text", keys: ["paragraph", "link_in_body"] as const },
  { group: "Headings", keys: ["article_h2", "article_h3", "article_h4"] as const },
  { group: "Lists", keys: ["unordered_list", "ordered_list", "list_item"] as const },
  { group: "Media", keys: ["figure", "figcaption"] as const },
  { group: "Block elements", keys: ["blockquote", "hr"] as const },
  { group: "Code", keys: ["code_inline", "code_block"] as const },
] as const;

type BlogStylingKey =
  | "article_container"
  | "paragraph"
  | "link_in_body"
  | "blockquote"
  | "unordered_list"
  | "ordered_list"
  | "list_item"
  | "figure"
  | "figcaption"
  | "code_inline"
  | "code_block"
  | "hr"
  | "article_h2"
  | "article_h3"
  | "article_h4";

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
  const searchParams = useSearchParams();
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

  // Spec 03 §1.3 — blog-styling sub-flow state.
  const [blogStylingExpanded, setBlogStylingExpanded] = useState<boolean>(
    () => searchParams?.get("focus") === "blog-styling",
  );
  const [blogUrls, setBlogUrls] = useState<[string, string, string]>([
    seededDesign?.blog_styling?.source_blog_urls?.[0] ?? "",
    seededDesign?.blog_styling?.source_blog_urls?.[1] ?? "",
    seededDesign?.blog_styling?.source_blog_urls?.[2] ?? "",
  ]);
  const [blogExtracting, setBlogExtracting] = useState(false);

  // Auto-expand the section when ?focus=blog-styling lands in the URL,
  // even after the initial render (e.g., after the operator clicks the
  // preflight banner link from another page).
  useEffect(() => {
    if (searchParams?.get("focus") === "blog-styling") {
      setBlogStylingExpanded(true);
    }
  }, [searchParams]);

  function setBlogUrl(idx: 0 | 1 | 2, value: string) {
    setBlogUrls((prev) => {
      const next = [...prev] as [string, string, string];
      next[idx] = value;
      return next;
    });
  }

  function setBlogStylingValue(key: BlogStylingKey, value: string) {
    setDesign((prev) => {
      const current: BlogStyling = prev.blog_styling ?? {
        source_blog_urls: blogUrls.filter((u) => u.trim().length > 0),
        article_container: null,
        paragraph: null,
        link_in_body: null,
        blockquote: null,
        unordered_list: null,
        ordered_list: null,
        list_item: null,
        figure: null,
        figcaption: null,
        code_inline: null,
        code_block: null,
        hr: null,
        article_h2: null,
        article_h3: null,
        article_h4: null,
        notes: [],
        extracted_at: new Date().toISOString(),
      };
      const next: BlogStyling = { ...current, [key]: value.trim() || null };
      return { ...prev, blog_styling: next };
    });
  }

  // Same-origin client-side check for the blog-URL inputs.
  function blogUrlSameOrigin(value: string): boolean {
    if (!value.trim()) return true;
    try {
      const candidate = new URL(value).hostname.toLowerCase();
      const primary = new URL(siteUrl).hostname.toLowerCase();
      // Subdomains allowed: candidate must end with primary's
      // registrable-ish suffix. Conservative check: same hostname OR
      // shares the trailing 2+ labels.
      if (candidate === primary) return true;
      const candidateSuffix = candidate.split(".").slice(-2).join(".");
      const primarySuffix = primary.split(".").slice(-2).join(".");
      return candidateSuffix === primarySuffix;
    } catch {
      return false;
    }
  }

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
          blog_urls: blogUrls.filter((u) => u.trim().length > 0),
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

  async function runBlogStylingExtraction() {
    setBlogExtracting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sites/${siteId}/setup/extract`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          extra_pages: parseExtraPages(extraPagesText),
          blog_urls: blogUrls.filter((u) => u.trim().length > 0),
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
            : `Blog-styling extraction failed (HTTP ${res.status}).`,
        );
        return;
      }
      const result = payload.data;
      // Merge blog_styling into existing design without replacing the
      // landing-page extraction. If the design itself was empty
      // (operator hadn't run primary extraction yet), seed it from the
      // result.
      setDesign((prev) => ({
        ...result.design,
        // preserve operator-edited values on existing fields when they
        // had results; only the blog_styling sub-tree is the new info.
        colors: hasResults ? prev.colors : result.design.colors,
        fonts: hasResults ? prev.fonts : result.design.fonts,
        layout_density: hasResults ? prev.layout_density : result.design.layout_density,
        visual_tone: hasResults ? prev.visual_tone : result.design.visual_tone,
        screenshot_url: hasResults ? prev.screenshot_url : result.design.screenshot_url,
        source_pages: hasResults ? prev.source_pages : result.design.source_pages,
        blog_styling: result.design.blog_styling ?? null,
      }));
      if (!hasResults) {
        setCssClasses(result.css_classes);
        setHasResults(true);
      }
      setNotes(result.notes);
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBlogExtracting(false);
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
          <p className="mt-1 text-base text-muted-foreground">
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

      <BlogStylingSection
        siteUrl={siteUrl}
        expanded={blogStylingExpanded}
        setExpanded={setBlogStylingExpanded}
        blogUrls={blogUrls}
        setBlogUrl={setBlogUrl}
        sameOrigin={blogUrlSameOrigin}
        blogStyling={design.blog_styling ?? null}
        setBlogStylingValue={setBlogStylingValue}
        extracting={blogExtracting}
        runExtraction={runBlogStylingExtraction}
      />

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

function BlogStylingSection({
  siteUrl,
  expanded,
  setExpanded,
  blogUrls,
  setBlogUrl,
  sameOrigin,
  blogStyling,
  setBlogStylingValue,
  extracting,
  runExtraction,
}: {
  siteUrl: string;
  expanded: boolean;
  setExpanded: (next: boolean) => void;
  blogUrls: [string, string, string];
  setBlogUrl: (idx: 0 | 1 | 2, value: string) => void;
  sameOrigin: (value: string) => boolean;
  blogStyling: BlogStyling | null;
  setBlogStylingValue: (key: BlogStylingKey, value: string) => void;
  extracting: boolean;
  runExtraction: () => Promise<void>;
}) {
  const hasAnyUrl = blogUrls.some((u) => u.trim().length > 0);
  const ageLabel =
    blogStyling?.extracted_at
      ? `Calibrated ${formatRelativeTime(blogStyling.extracted_at)}`
      : null;
  void siteUrl; // referenced via sameOrigin closure
  return (
    <section
      className="rounded-md border bg-background p-4"
      data-testid="copy-existing-blog-styling"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-sm font-semibold hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
            data-testid="blog-styling-toggle"
            aria-expanded={expanded}
          >
            Blog styling (optional) {expanded ? "▾" : "▸"}
          </button>
          <p className="mt-1 text-sm text-muted-foreground">
            Calibrate how blog posts are styled on your existing site
          </p>
          {ageLabel && (
            <p className="mt-1 text-sm text-muted-foreground">{ageLabel}</p>
          )}
        </div>
      </header>

      {expanded && (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Paste 1–3 example blog post URLs from this site. We&apos;ll
            learn how your blog posts are styled and apply that to
            generated content. Optional but recommended for sites that
            publish blogs.
          </p>

          <div className="space-y-2">
            {[0, 1, 2].map((i) => {
              const idx = i as 0 | 1 | 2;
              const value = blogUrls[idx];
              const sameOriginOk = sameOrigin(value);
              return (
                <label
                  key={i}
                  className="flex flex-col gap-1 text-sm"
                  htmlFor={`blog-url-${i + 1}`}
                >
                  <span className="text-muted-foreground">
                    Blog URL {i + 1}
                    {i === 0 && " (required to extract)"}
                  </span>
                  <input
                    id={`blog-url-${i + 1}`}
                    type="url"
                    inputMode="url"
                    value={value}
                    onChange={(e) => setBlogUrl(idx, e.target.value)}
                    placeholder={`https://example.com/blog/post-${i + 1}`}
                    className="rounded border bg-background px-2 py-1 text-sm"
                    data-testid={`blog-url-${i + 1}`}
                  />
                  {!sameOriginOk && (
                    <span className="text-sm text-destructive">
                      Must be on the same site
                    </span>
                  )}
                </label>
              );
            })}
          </div>

          <div>
            <Button
              type="button"
              onClick={() => void runExtraction()}
              disabled={extracting || !hasAnyUrl}
              data-testid="blog-styling-extract-run"
            >
              {extracting
                ? "Extracting…"
                : blogStyling
                  ? "Re-extract"
                  : "Extract blog styling"}
            </Button>
          </div>

          {blogStyling && (
            <div className="space-y-4">
              {BLOG_STYLING_BUCKETS.map((group) => (
                <div key={group.group}>
                  <h3 className="text-base font-semibold">{group.group}</h3>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    {group.keys.map((key) => (
                      <label
                        key={key}
                        className="flex items-center gap-2 text-sm"
                      >
                        <span className="w-32 text-muted-foreground">
                          {key.replace(/_/g, " ")}
                        </span>
                        <input
                          type="text"
                          value={blogStyling[key] ?? ""}
                          onChange={(e) =>
                            setBlogStylingValue(key, e.target.value)
                          }
                          placeholder="(none)"
                          className="flex-1 rounded border bg-background px-2 py-1 font-mono text-sm"
                          data-testid={`blog-styling-${key}`}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}

              {blogStyling.notes.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
                  {blogStyling.notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
