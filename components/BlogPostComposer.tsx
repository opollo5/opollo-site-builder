"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Composer, type ComposerValue } from "@/components/Composer";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  parseBlogPostMetadata,
  slugify,
  type BlogPostMetadata,
  type ParseSource,
} from "@/lib/blog-post-parser";

// ---------------------------------------------------------------------------
// BP-3 — Blog-post entry-point composer.
//
// Composes the RS-1 Composer (paste / drag-drop / + attach) with the
// BP-1 smart-parser. Each metadata field surfaces the parser's source
// inline so the operator can see "Auto-filled from YAML title" — same
// affordance whether they paste markdown, HTML, or a YAML-fenced
// document.
//
// Save-draft posts to /api/sites/[id]/posts and routes to the post's
// detail page on success. The "Start run" button is disabled with
// "Featured image required" copy until BP-4 (image picker) and BP-8
// (run-start gate) wire it.
// ---------------------------------------------------------------------------

const PARSE_DEBOUNCE_MS = 200;

const SOURCE_HINTS: Record<ParseSource, string> = {
  yaml: "Auto-filled from YAML front-matter",
  inline: "Auto-filled from inline label",
  html: "Auto-filled from HTML meta",
  h1: "Auto-filled from first heading",
  first_paragraph: "Auto-filled from first paragraph",
  derived: "Derived from title",
  none: "",
};

const ERROR_TRANSLATIONS: Record<string, string> = {
  UNIQUE_VIOLATION:
    "A post with this slug already exists on this site. Pick a different slug.",
  VALIDATION_FAILED: "Some fields are invalid. Check the form and try again.",
  FORBIDDEN: "Your account doesn't have permission to create posts on this site.",
  UNAUTHORIZED: "Please sign in again.",
  NOT_FOUND: "This site no longer exists. Refresh and try again.",
};

function SourceHint({ source }: { source: ParseSource }) {
  if (source === "none") return null;
  return (
    <span className="text-xs text-muted-foreground">{SOURCE_HINTS[source]}</span>
  );
}

interface FieldState {
  value: string;
  source: ParseSource;
  // True once the operator has typed in this field; locks it from
  // further parser overwrites so the operator's edit isn't clobbered
  // by a debounced parse from the textarea below.
  touched: boolean;
}

function emptyField(): FieldState {
  return { value: "", source: "none", touched: false };
}

function applyParse(
  current: FieldState,
  parsed: string | null,
  source: ParseSource,
): FieldState {
  if (current.touched) return current;
  if (parsed === null) return current;
  return { value: parsed, source, touched: false };
}

export function BlogPostComposer({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [composerValue, setComposerValue] = useState<ComposerValue>({
    text: "",
    file: null,
  });
  const [title, setTitle] = useState<FieldState>(emptyField);
  const [slug, setSlug] = useState<FieldState>(emptyField);
  const [metaTitle, setMetaTitle] = useState<FieldState>(emptyField);
  const [metaDescription, setMetaDescription] = useState<FieldState>(emptyField);
  const [parentPage, setParentPage] = useState(""); // BP-8 will swap for combobox
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [lastParse, setLastParse] = useState<BlogPostMetadata | null>(null);

  // Debounced re-parse on every text change. Pure-logic call, but
  // 200ms keeps every keystroke from reflowing four field updates.
  useEffect(() => {
    if (composerValue.text.length === 0) {
      setLastParse(null);
      return;
    }
    const id = setTimeout(() => {
      const parsed = parseBlogPostMetadata(composerValue.text);
      setLastParse(parsed);
      setTitle((cur) => applyParse(cur, parsed.title, parsed.source_map.title));
      setSlug((cur) => applyParse(cur, parsed.slug, parsed.source_map.slug));
      setMetaTitle((cur) =>
        applyParse(cur, parsed.meta_title, parsed.source_map.meta_title),
      );
      setMetaDescription((cur) =>
        applyParse(
          cur,
          parsed.meta_description,
          parsed.source_map.meta_description,
        ),
      );
    }, PARSE_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [composerValue.text]);

  // If the operator clears a touched field, snap it back to the
  // parsed value rather than leaving the form blank between edits.
  function setFieldValue(
    setter: typeof setTitle,
    value: string,
    parsedFallback: string | null,
    source: ParseSource,
  ) {
    if (value === "" && parsedFallback) {
      setter({ value: parsedFallback, source, touched: false });
    } else {
      setter({ value, source, touched: true });
    }
  }

  const slugIsValid = useMemo(
    () => /^[a-z0-9-]+$/.test(slug.value) && slug.value.length > 0,
    [slug.value],
  );
  const titleIsValid = title.value.trim().length > 0;
  const metaDescriptionIsValid =
    metaDescription.value.trim().length > 0 &&
    metaDescription.value.length <= 160;

  const canSaveDraft =
    !submitting &&
    titleIsValid &&
    slugIsValid &&
    composerValue.text.trim().length > 0;

  async function handleSaveDraft(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/posts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.value.trim(),
          slug: slug.value.trim(),
          excerpt:
            metaDescription.value.trim().length > 0
              ? metaDescription.value.trim()
              : null,
          metadata: lastParse ?? null,
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { ok: true; data: { id: string; edit_url: string } }
        | { ok: false; error: { code: string; message: string } }
        | null;
      if (payload?.ok) {
        router.push(payload.data.edit_url);
        return;
      }
      const code =
        payload?.ok === false ? payload.error.code : "INTERNAL_ERROR";
      const fallback =
        payload?.ok === false
          ? payload.error.message
          : `Save failed (HTTP ${res.status}).`;
      setFormError(ERROR_TRANSLATIONS[code] ?? fallback);
    } catch (err) {
      setFormError(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSaveDraft} className="space-y-6">
      <div>
        <label
          htmlFor="post-composer-input"
          className="block text-sm font-medium"
        >
          Post content
        </label>
        <Composer
          textareaId="post-composer-input"
          value={composerValue}
          onChange={setComposerValue}
          accept=".md,.html,.txt,text/markdown,text/html,text/plain"
          maxFileBytes={10 * 1024 * 1024}
          placeholder={`Type, paste, or drop your post.\n\nA YAML front-matter block, inline labels, or HTML meta tags will pre-fill the metadata fields below.`}
          acceptHint="Markdown, HTML, or plain text. Drag-drop, paste, or use + to attach. Max 10 MB."
          className="mt-1"
        />
      </div>

      <fieldset className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="post-title" className="block text-sm font-medium">
            Title
          </label>
          <Input
            id="post-title"
            className="mt-1"
            value={title.value}
            onChange={(e) =>
              setFieldValue(setTitle, e.target.value, lastParse?.title ?? null, "derived")
            }
            disabled={submitting}
            maxLength={200}
            aria-invalid={!titleIsValid}
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            <SourceHint source={title.source} />
            {!titleIsValid && (
              <span className="text-xs text-destructive">Title required.</span>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="post-slug" className="block text-sm font-medium">
            URL slug
          </label>
          <Input
            id="post-slug"
            className="mt-1"
            value={slug.value}
            onChange={(e) =>
              setFieldValue(
                setSlug,
                e.target.value.toLowerCase(),
                lastParse?.slug ?? null,
                lastParse?.source_map.slug ?? "derived",
              )
            }
            onBlur={() => {
              // Auto-clean on blur so the operator never has to think
              // about kebab-casing their own input.
              if (slug.value && !slugIsValid) {
                setSlug({
                  value: slugify(slug.value),
                  source: "derived",
                  touched: true,
                });
              }
            }}
            disabled={submitting}
            maxLength={100}
            aria-invalid={!slugIsValid}
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            <SourceHint source={slug.source} />
            {!slugIsValid && slug.value.length > 0 && (
              <span className="text-xs text-destructive">
                Lowercase letters, numbers, dashes only.
              </span>
            )}
          </div>
        </div>

        <div>
          <label
            htmlFor="post-meta-title"
            className="block text-sm font-medium"
          >
            Meta title (SEO)
          </label>
          <Input
            id="post-meta-title"
            className="mt-1"
            value={metaTitle.value}
            onChange={(e) =>
              setFieldValue(
                setMetaTitle,
                e.target.value,
                lastParse?.meta_title ?? null,
                lastParse?.source_map.meta_title ?? "derived",
              )
            }
            disabled={submitting}
            maxLength={200}
          />
          <SourceHint source={metaTitle.source} />
        </div>

        <div>
          <label
            htmlFor="post-parent-page"
            className="block text-sm font-medium"
          >
            Parent page
          </label>
          <Input
            id="post-parent-page"
            className="mt-1"
            value={parentPage}
            onChange={(e) => setParentPage(e.target.value)}
            disabled={submitting}
            placeholder="(BP-8 will replace this with a WP-page combobox)"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Free-text for now. BP-8 wires the WP /pages picker.
          </p>
        </div>

        <div className="md:col-span-2">
          <label
            htmlFor="post-meta-description"
            className="block text-sm font-medium"
          >
            Meta description (SEO)
          </label>
          <Textarea
            id="post-meta-description"
            className="mt-1"
            rows={3}
            value={metaDescription.value}
            onChange={(e) =>
              setFieldValue(
                setMetaDescription,
                e.target.value,
                lastParse?.meta_description ?? null,
                lastParse?.source_map.meta_description ?? "derived",
              )
            }
            disabled={submitting}
            maxLength={400}
            aria-invalid={
              metaDescription.value.length > 0 && !metaDescriptionIsValid
            }
          />
          <div className="mt-1 flex items-center justify-between gap-2 text-xs">
            <SourceHint source={metaDescription.source} />
            <span
              className={
                metaDescription.value.length > 160
                  ? "text-destructive"
                  : "text-muted-foreground"
              }
            >
              {metaDescription.value.length}/160
            </span>
          </div>
        </div>
      </fieldset>

      <div className="rounded-md border-2 border-dashed border-muted bg-muted/30 p-4 text-sm">
        <p className="font-medium">Featured image</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Picker lands in BP-4. For now, save as draft and add the image
          on the post detail page.
        </p>
      </div>

      {formError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {formError}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="submit" disabled={!canSaveDraft}>
          {submitting ? "Saving…" : "Save draft"}
        </Button>
        <Button
          type="button"
          disabled
          title="Featured image required (BP-4 + BP-8 will wire this)"
        >
          Start run
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Start run is disabled until the featured-image picker (BP-4) and
        run-start gate (BP-8) ship. Save a draft now and the post detail
        page will surface the start affordance.
      </p>
    </form>
  );
}
