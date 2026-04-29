"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Composer, type ComposerValue } from "@/components/Composer";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  ImagePickerModal,
  type ImagePickerEntry,
} from "@/components/ImagePickerModal";
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
  // BP-8 — parent page comes from a combobox backed by /api/sites/[id]/wp-pages.
  const [parentPage, setParentPage] = useState<WpPageOption | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [lastParse, setLastParse] = useState<BlogPostMetadata | null>(null);
  // BP-4 — featured image is local-only state for now. BP-7 will
  // persist via posts.featured_image_id and transfer to WP at publish.
  const [featuredImage, setFeaturedImage] =
    useState<ImagePickerEntry | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

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
  const metaTitleIsValid = metaTitle.value.trim().length > 0;
  const metaDescriptionIsValid =
    metaDescription.value.trim().length > 0 &&
    metaDescription.value.length <= 160;

  const canSaveDraft =
    !submitting &&
    titleIsValid &&
    slugIsValid &&
    composerValue.text.trim().length > 0;

  // BP-8 — Start Run gate. All publish-time required fields must be
  // valid. Today Start Run does the same thing as Save Draft (router
  // push to detail); BP-7 will plumb the actual featured-image transfer
  // + WP create at this point.
  const canStartRun =
    canSaveDraft &&
    metaTitleIsValid &&
    metaDescriptionIsValid &&
    parentPage !== null &&
    featuredImage !== null;

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
          // BP-7 — persist the picker selection so publish-time can
          // transfer it to WP without the operator re-picking.
          featured_image_id: featuredImage?.id ?? null,
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
          <WpPageCombobox
            siteId={siteId}
            value={parentPage}
            onChange={setParentPage}
            disabled={submitting}
            triggerId="post-parent-page"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Where this post will live in the WP site tree (queries
            <code className="ml-1 font-mono">/wp/v2/pages</code>).
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

      <div className="rounded-md border p-4 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">Featured image</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Required at publish (enforced by BP-7&apos;s server-side
              guard). Selecting here previews; persistence + WP attachment
              ship in BP-7.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPickerOpen(true)}
            disabled={submitting}
          >
            {featuredImage ? "Change image" : "Pick image"}
          </Button>
        </div>
        {featuredImage && featuredImage.delivery_url && (
          <div className="mt-3 flex items-center gap-3">
            {/* Cloudflare Images delivery URL — no Next/Image to avoid
                wiring imagedelivery.net into next.config remotePatterns
                for a thumbnail with explicit w=/h= params already. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${featuredImage.delivery_url}/w=120,h=120,fit=cover`}
              alt={featuredImage.alt_text ?? featuredImage.caption ?? ""}
              className="h-20 w-20 rounded-md border object-cover"
            />
            <div className="min-w-0">
              <p
                className="truncate text-sm font-medium"
                title={featuredImage.caption ?? featuredImage.filename ?? ""}
              >
                {featuredImage.caption ?? featuredImage.filename ?? "Untitled"}
              </p>
              <button
                type="button"
                onClick={() => setFeaturedImage(null)}
                className="text-xs text-muted-foreground underline hover:text-foreground"
              >
                Remove
              </button>
            </div>
          </div>
        )}
      </div>

      {formError && <Alert variant="destructive">{formError}</Alert>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="submit" disabled={!canSaveDraft}>
          {submitting ? "Saving…" : "Save draft"}
        </Button>
        <Button
          type="submit"
          disabled={!canStartRun}
          title={
            canStartRun
              ? "Save the draft and continue to publish."
              : "All required fields must be valid: title, slug, meta title, meta description, parent page, featured image."
          }
        >
          {submitting ? "Saving…" : "Start run"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Start run currently saves a draft and routes to the post detail
        page. BP-7 will plumb the featured-image transfer + WP create
        directly from this button.
      </p>

      <ImagePickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(image) => setFeaturedImage(image)}
      />
    </form>
  );
}

// ---------------------------------------------------------------------------
// BP-8 — WP parent-page combobox.
//
// Backed by /api/sites/[id]/wp-pages. Search is forwarded to WP's
// `search` param (full-text against title + slug). Fetches once on
// open then on debounced query change.
// ---------------------------------------------------------------------------

export interface WpPageOption {
  page_id: number;
  title: string;
  slug: string;
}

function WpPageCombobox({
  siteId,
  value,
  onChange,
  disabled,
  triggerId,
}: {
  siteId: string;
  value: WpPageOption | null;
  onChange: (next: WpPageOption | null) => void;
  disabled?: boolean;
  triggerId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState<WpPageOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        const res = await fetch(
          `/api/sites/${siteId}/wp-pages?${params.toString()}`,
          { signal: ctrl.signal, cache: "no-store" },
        );
        if (ctrl.signal.aborted) return;
        const payload = (await res.json().catch(() => null)) as
          | {
              ok: true;
              data: {
                pages: { page_id: number; title: string; slug: string }[];
              };
            }
          | { ok: false; error: { code: string; message: string } }
          | null;
        if (!payload?.ok) {
          setError(
            payload?.ok === false
              ? payload.error.message
              : `Failed to load WP pages (HTTP ${res.status}).`,
          );
          setPages([]);
          return;
        }
        setPages(
          payload.data.pages.map((p) => ({
            page_id: p.page_id,
            title: p.title,
            slug: p.slug,
          })),
        );
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [open, query, siteId]);

  return (
    <Popover open={open} onOpenChange={(next) => !disabled && setOpen(next)}>
      <PopoverTrigger asChild>
        <button
          id={triggerId}
          type="button"
          disabled={disabled}
          className="mt-1 flex h-10 w-full items-center justify-between rounded-md border bg-background px-3 text-sm transition-smooth focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className={value ? "" : "text-muted-foreground"}>
            {value ? `${value.title} (${value.slug})` : "Pick a parent page…"}
          </span>
          <ChevronDown
            aria-hidden
            className="ml-2 h-4 w-4 text-muted-foreground"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search pages by title or slug"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {error && (
              <div
                role="alert"
                className="px-3 py-2 text-xs text-destructive"
              >
                {error}
              </div>
            )}
            <CommandEmpty>
              {loading ? "Loading…" : "No pages match."}
            </CommandEmpty>
            {pages.map((p) => (
              <CommandItem
                key={p.page_id}
                value={`${p.title} ${p.slug}`}
                onSelect={() => {
                  onChange(p);
                  setOpen(false);
                }}
              >
                <span className="flex-1 truncate">{p.title}</span>
                <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                  /{p.slug}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
