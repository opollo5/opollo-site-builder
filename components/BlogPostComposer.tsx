"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";

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
import { cn, formatRelativeTime } from "@/lib/utils";

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
//
// BL-2 layered on:
//   - localStorage autosave (debounced 800ms). Keyed by siteId so two
//     drafts on different sites don't collide. Saved state indicator
//     reads "Saving…" / "Saved · just now" / "Saved 2m ago".
//   - Progressive disclosure — meta title / meta description / parent
//     page / featured image collapse behind a "More options" toggle
//     that auto-opens when any of those fields has a value (parser
//     pre-fill or operator edit). Save Draft works without expanding.
// ---------------------------------------------------------------------------

const PARSE_DEBOUNCE_MS = 200;
const AUTOSAVE_DEBOUNCE_MS = 800;
const AUTOSAVE_STATUS_FRESH_MS = 1500;

// BL-3 — SEO recommendation envelopes. These are advisory only;
// neither field is hard-capped at the recommendation line. Matches
// what Google / Bing show in SERPs as of mid-2025.
const TITLE_SEO_CAP = 60;
const META_TITLE_SEO_CAP = 60;
const META_DESCRIPTION_SEO_MIN = 120;
const META_DESCRIPTION_SEO_MAX = 160;
// Adult reading speed for prose, words-per-minute. Substack uses ~250.
const READING_WPM = 230;

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

// BL-3 — word + reading-time counter. Strips HTML tags, fenced code
// blocks, and YAML front-matter so the figure tracks "what the reader
// sees" rather than "raw markdown the operator pasted".
function wordCount(text: string): number {
  if (!text) return 0;
  const stripped = text
    .replace(/^---[\s\S]*?---/, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/[#*_>~`-]+/g, " ");
  const tokens = stripped.split(/\s+/).filter((t) => t.length > 0);
  return tokens.length;
}

function readingMinutes(words: number): number {
  if (words === 0) return 0;
  return Math.max(1, Math.round(words / READING_WPM));
}

// BL-2 autosave shape — kept narrow on purpose so a future schema
// change (e.g. a new field on FieldState) doesn't silently corrupt
// stored drafts. Restoration tolerates partial / missing fields.
interface DraftSnapshot {
  v: 1;
  composerText: string;
  title: FieldState;
  slug: FieldState;
  metaTitle: FieldState;
  metaDescription: FieldState;
  parentPage: WpPageOption | null;
  featuredImage: ImagePickerEntry | null;
  savedAt: number;
}

function draftStorageKey(siteId: string): string {
  return `opollo:post-draft:${siteId}`;
}

type AutosaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number };

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
  // BL-2 — autosave state machine + disclosure toggle.
  const [autosave, setAutosave] = useState<AutosaveState>({ kind: "idle" });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [draftRestoredAt, setDraftRestoredAt] = useState<number | null>(null);
  // Hydration guard — restore-from-localStorage runs once, AFTER mount,
  // so SSR + first client render match. The ref blocks autosave from
  // firing during the restore tick (otherwise the restored values would
  // immediately get re-saved and trigger a Saved indicator on load).
  const restoredRef = useRef(false);

  // BL-2 — restore from localStorage on mount. Runs once per siteId.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(draftStorageKey(siteId));
      if (!raw) {
        restoredRef.current = true;
        return;
      }
      const parsed = JSON.parse(raw) as DraftSnapshot;
      if (parsed?.v !== 1) {
        restoredRef.current = true;
        return;
      }
      // Apply each section guardedly so a partial snapshot doesn't
      // throw. Operator can still type into anything that's missing.
      if (typeof parsed.composerText === "string") {
        setComposerValue({ text: parsed.composerText, file: null });
      }
      if (parsed.title) setTitle(parsed.title);
      if (parsed.slug) setSlug(parsed.slug);
      if (parsed.metaTitle) setMetaTitle(parsed.metaTitle);
      if (parsed.metaDescription) setMetaDescription(parsed.metaDescription);
      if (parsed.parentPage !== undefined) setParentPage(parsed.parentPage);
      if (parsed.featuredImage !== undefined) {
        setFeaturedImage(parsed.featuredImage);
      }
      // Surface the restore in the saved indicator + auto-open the
      // disclosure if the restored draft used any advanced fields.
      setDraftRestoredAt(parsed.savedAt);
      if (
        parsed.metaTitle?.value ||
        parsed.metaDescription?.value ||
        parsed.parentPage ||
        parsed.featuredImage
      ) {
        setShowAdvanced(true);
      }
    } catch {
      // Corrupt JSON — wipe the slot so subsequent loads don't loop.
      try {
        window.localStorage.removeItem(draftStorageKey(siteId));
      } catch {}
    } finally {
      restoredRef.current = true;
    }
    // siteId is the storage key — re-run when the operator switches
    // sites (PostsNewClient remounts BlogPostComposer on site change,
    // but defending against in-place siteId swaps too).
  }, [siteId]);

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

  // BL-2 — debounced autosave to localStorage. Skips while the form is
  // submitting (the success path navigates away anyway) and waits for
  // the initial restore to complete so we don't immediately re-save
  // the snapshot we just loaded.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!restoredRef.current) return;
    if (submitting) return;
    // Empty form? Don't pollute storage with an empty snapshot.
    if (
      composerValue.text.length === 0 &&
      title.value.length === 0 &&
      slug.value.length === 0 &&
      metaTitle.value.length === 0 &&
      metaDescription.value.length === 0 &&
      parentPage === null &&
      featuredImage === null
    ) {
      return;
    }
    setAutosave({ kind: "saving" });
    const id = setTimeout(() => {
      const snapshot: DraftSnapshot = {
        v: 1,
        composerText: composerValue.text,
        title,
        slug,
        metaTitle,
        metaDescription,
        parentPage,
        featuredImage,
        savedAt: Date.now(),
      };
      try {
        window.localStorage.setItem(
          draftStorageKey(siteId),
          JSON.stringify(snapshot),
        );
        setAutosave({ kind: "saved", at: snapshot.savedAt });
      } catch {
        // Quota / disabled — fall back to idle so the indicator clears.
        setAutosave({ kind: "idle" });
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [
    composerValue.text,
    title,
    slug,
    metaTitle,
    metaDescription,
    parentPage,
    featuredImage,
    siteId,
    submitting,
  ]);

  const discardDraft = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(draftStorageKey(siteId));
    } catch {}
    setComposerValue({ text: "", file: null });
    setTitle(emptyField());
    setSlug(emptyField());
    setMetaTitle(emptyField());
    setMetaDescription(emptyField());
    setParentPage(null);
    setFeaturedImage(null);
    setLastParse(null);
    setAutosave({ kind: "idle" });
    setDraftRestoredAt(null);
    setShowAdvanced(false);
  }, [siteId]);

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

  // BL-8 — ⌘S / Ctrl+S triggers Save Draft from anywhere on the form.
  // The browser's "save page" dialog interception is the standard
  // shortcut operators expect from prose tools.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isCmdS =
        (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === "s";
      if (!isCmdS) return;
      if (!canSaveDraft) return;
      e.preventDefault();
      // Submit via the form so React's onSubmit handler runs (we
      // ride the same path Save Draft button takes).
      const formEl = document.getElementById(
        `blog-post-composer-form-${siteId}`,
      ) as HTMLFormElement | null;
      formEl?.requestSubmit();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSaveDraft, siteId]);

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
        // BL-2 — wipe the autosave slot before navigating so a refresh
        // on the detail page doesn't restore a now-saved snapshot.
        try {
          window.localStorage.removeItem(draftStorageKey(siteId));
        } catch {}
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
    <form
      id={`blog-post-composer-form-${siteId}`}
      onSubmit={handleSaveDraft}
      className="space-y-6"
    >
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <label
            htmlFor="post-composer-input"
            className="block text-sm font-medium"
          >
            Post content
          </label>
          <ReadingChip text={composerValue.text} />
        </div>
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
            <TitleLengthHint
              length={title.value.length}
              valid={titleIsValid}
            />
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
      </fieldset>

      <AdvancedDisclosure
        open={showAdvanced}
        onToggle={() => setShowAdvanced((v) => !v)}
        summary={summarizeAdvanced({
          metaTitle,
          metaDescription,
          parentPage,
          featuredImage,
        })}
      >
        <fieldset className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
            <div className="mt-1 flex items-center justify-between gap-2">
              <SourceHint source={metaTitle.source} />
              <MetaTitleLengthHint length={metaTitle.value.length} />
            </div>
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
              <MetaDescriptionLengthHint
                length={metaDescription.value.length}
              />
            </div>
          </div>
        </fieldset>

        <div className="mt-4 rounded-md border p-4 text-sm">
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
      </AdvancedDisclosure>

      {formError && <Alert variant="destructive">{formError}</Alert>}

      {/* BL-2 — saved indicator + restored draft notice + discard button.
          Sits flush above the action row so the operator catches the
          state change in their primary scan path. */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <SaveStatus
          autosave={autosave}
          restoredAt={draftRestoredAt}
          onDiscard={discardDraft}
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <span
          aria-hidden
          className="hidden items-center gap-0.5 text-xs text-muted-foreground sm:inline-flex"
        >
          <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">
            ⌘
          </kbd>
          <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">
            S
          </kbd>
        </span>
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
      {!canStartRun && canSaveDraft && (
        <p className="text-xs text-muted-foreground">
          Start run needs the SEO meta fields, parent page, and featured
          image — open <button
            type="button"
            onClick={() => setShowAdvanced(true)}
            className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
          >
            More options
          </button>
          {" "}to fill them in.
        </p>
      )}

      <ImagePickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(image) => setFeaturedImage(image)}
        // R1-5 — pre-save suggestion context. Composer doesn't have a
        // post id yet (save creates one); pass title + body snippet
        // weighted toward title (3× repeat) so the picker's Suggested
        // tab can FTS-rank library images.
        suggestionContext={
          title.value.trim().length > 0 || composerValue.text.trim().length > 0
            ? `${title.value} ${title.value} ${title.value} ${composerValue.text.slice(0, 400)}`.trim()
            : null
        }
      />
    </form>
  );
}

// ---------------------------------------------------------------------------
// BL-3 — Inline length / reading-time hints. Pure presentational.
// ---------------------------------------------------------------------------

function ReadingChip({ text }: { text: string }) {
  const words = wordCount(text);
  if (words === 0) return null;
  const minutes = readingMinutes(words);
  return (
    <span
      data-testid="post-reading-chip"
      // BL-9 — fade-in the first time the chip surfaces. Re-runs on
      // remount only (text changes don't re-trigger because React
      // doesn't add the class on re-render of an already-mounted node).
      className="opollo-fade-in text-xs text-muted-foreground"
    >
      {words.toLocaleString()} {words === 1 ? "word" : "words"} ·{" "}
      {minutes} min read
    </span>
  );
}

function TitleLengthHint({
  length,
  valid,
}: {
  length: number;
  valid: boolean;
}) {
  if (!valid) {
    return (
      <span className="text-xs text-destructive">Title required.</span>
    );
  }
  if (length === 0) return null;
  const overSeoCap = length > TITLE_SEO_CAP;
  return (
    <span
      data-testid="post-title-length-hint"
      className={cn(
        "text-xs",
        overSeoCap ? "text-warning" : "text-muted-foreground",
      )}
    >
      {length}/{TITLE_SEO_CAP}
      {overSeoCap && " · search will truncate"}
    </span>
  );
}

function MetaTitleLengthHint({ length }: { length: number }) {
  if (length === 0) return null;
  const overSeoCap = length > META_TITLE_SEO_CAP;
  return (
    <span
      data-testid="post-meta-title-length-hint"
      className={cn(
        "text-xs",
        overSeoCap ? "text-warning" : "text-muted-foreground",
      )}
    >
      {length}/{META_TITLE_SEO_CAP}
      {overSeoCap && " · search will truncate"}
    </span>
  );
}

function MetaDescriptionLengthHint({ length }: { length: number }) {
  // Three states: empty / under-min / sweet-spot / over-max. The
  // sweet spot reads as positive ("good length"); the over-max state
  // gates the form via aria-invalid + this destructive label.
  if (length === 0) {
    return (
      <span className="text-muted-foreground">
        Aim for {META_DESCRIPTION_SEO_MIN}–{META_DESCRIPTION_SEO_MAX} chars.
      </span>
    );
  }
  if (length > META_DESCRIPTION_SEO_MAX) {
    return (
      <span data-testid="post-meta-description-length-hint" className="text-destructive">
        {length}/{META_DESCRIPTION_SEO_MAX} · search will truncate
      </span>
    );
  }
  if (length < META_DESCRIPTION_SEO_MIN) {
    return (
      <span data-testid="post-meta-description-length-hint" className="text-muted-foreground">
        {length}/{META_DESCRIPTION_SEO_MAX} · aim for {META_DESCRIPTION_SEO_MIN}+
      </span>
    );
  }
  return (
    <span data-testid="post-meta-description-length-hint" className="text-success">
      {length}/{META_DESCRIPTION_SEO_MAX} · good length
    </span>
  );
}

// ---------------------------------------------------------------------------
// BL-2 — Progressive disclosure wrapper for advanced fields.
// ---------------------------------------------------------------------------

function summarizeAdvanced({
  metaTitle,
  metaDescription,
  parentPage,
  featuredImage,
}: {
  metaTitle: FieldState;
  metaDescription: FieldState;
  parentPage: WpPageOption | null;
  featuredImage: ImagePickerEntry | null;
}): string {
  const filled: string[] = [];
  if (metaTitle.value.trim()) filled.push("meta title");
  if (metaDescription.value.trim()) filled.push("meta description");
  if (parentPage) filled.push("parent page");
  if (featuredImage) filled.push("featured image");
  if (filled.length === 0) return "SEO meta, parent page, featured image";
  return filled.join(", ");
}

function AdvancedDisclosure({
  open,
  onToggle,
  summary,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-muted/20">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        data-testid="post-advanced-toggle"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-smooth hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {open ? (
          <ChevronDown aria-hidden className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight aria-hidden className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="font-medium">More options</span>
        <span className="truncate text-xs text-muted-foreground">{summary}</span>
      </button>
      {open && (
        <div
          data-testid="post-advanced-panel"
          className="opollo-slide-up border-t p-4"
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BL-2 — Save status indicator. Reads the autosave state machine and
// surfaces a single inline string the operator can scan without context
// switching.
// ---------------------------------------------------------------------------

function SaveStatus({
  autosave,
  restoredAt,
  onDiscard,
}: {
  autosave: AutosaveState;
  restoredAt: number | null;
  onDiscard: () => void;
}) {
  // Restore notice takes priority on first paint; once the operator
  // edits anything the autosave indicator owns the slot.
  const showingRestore = restoredAt !== null && autosave.kind === "idle";

  let label = "";
  if (showingRestore) {
    label = `Draft restored from ${formatRelativeTime(
      new Date(restoredAt!).toISOString(),
    )}.`;
  } else if (autosave.kind === "saving") {
    label = "Saving…";
  } else if (autosave.kind === "saved") {
    const fresh = Date.now() - autosave.at < AUTOSAVE_STATUS_FRESH_MS;
    label = fresh
      ? "Saved · just now"
      : `Saved · ${formatRelativeTime(new Date(autosave.at).toISOString())}`;
  }

  return (
    <span
      data-testid="post-save-status"
      className={cn(
        "inline-flex items-center gap-2 transition-smooth",
        label ? "opacity-100" : "opacity-0",
      )}
      aria-live="polite"
    >
      {label && <span>{label}</span>}
      {(showingRestore || autosave.kind === "saved") && (
        <button
          type="button"
          onClick={onDiscard}
          className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Discard draft
        </button>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// BP-8 / BL-4 — WP parent-page combobox.
//
// Backed by /api/sites/[id]/wp-pages. Search is forwarded to WP's
// `search` param (full-text against title + slug).
//
// BL-4 layered caching + prefetch on top of the BP-8 fetch loop:
//   - Module-level Map keyed by `${siteId}:${query}` with 60s TTL. Two
//     opens of the same combobox within a minute reuse the result so
//     the dropdown opens instantly. Cache invalidates per-site (a real
//     wp-pages mutation would need a manual `invalidateWpPagesCache`
//     call — none today).
//   - `onFocus` on the trigger button kicks off the empty-query fetch
//     before the operator clicks, so the popover usually has data
//     ready by the time it renders.
//   - `onPointerEnter` on the trigger does the same, for mouse users.
// ---------------------------------------------------------------------------

export interface WpPageOption {
  page_id: number;
  title: string;
  slug: string;
}

const WP_PAGES_CACHE_TTL_MS = 60_000;

interface CacheEntry {
  pages: WpPageOption[];
  fetchedAt: number;
}

const wpPagesCache = new Map<string, CacheEntry>();
const wpPagesInflight = new Map<string, Promise<WpPageOption[] | null>>();

function wpPagesCacheKey(siteId: string, query: string): string {
  return `${siteId}:${query.trim().toLowerCase()}`;
}

async function fetchWpPages(
  siteId: string,
  query: string,
  signal: AbortSignal,
): Promise<WpPageOption[]> {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  const res = await fetch(
    `/api/sites/${siteId}/wp-pages?${params.toString()}`,
    { signal, cache: "no-store" },
  );
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
    const msg =
      payload?.ok === false
        ? payload.error.message
        : `Failed to load WP pages (HTTP ${res.status}).`;
    throw new Error(msg);
  }
  return payload.data.pages.map((p) => ({
    page_id: p.page_id,
    title: p.title,
    slug: p.slug,
  }));
}

// Cache-aware fetcher. Returns immediately on a fresh hit; otherwise
// dedupes inflight requests so a focus + open + query-change trio
// doesn't trigger three identical fetches in flight at once.
async function loadWpPages(
  siteId: string,
  query: string,
  signal: AbortSignal,
): Promise<{ pages: WpPageOption[]; fromCache: boolean }> {
  const key = wpPagesCacheKey(siteId, query);
  const cached = wpPagesCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < WP_PAGES_CACHE_TTL_MS) {
    return { pages: cached.pages, fromCache: true };
  }
  let inflight = wpPagesInflight.get(key);
  if (!inflight) {
    inflight = (async () => {
      try {
        const pages = await fetchWpPages(siteId, query, signal);
        wpPagesCache.set(key, { pages, fetchedAt: Date.now() });
        return pages;
      } catch (err) {
        if (signal.aborted) return null;
        throw err;
      } finally {
        wpPagesInflight.delete(key);
      }
    })();
    wpPagesInflight.set(key, inflight);
  }
  const pages = await inflight;
  if (pages === null) throw new DOMException("Aborted", "AbortError");
  return { pages, fromCache: false };
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
  const [pages, setPages] = useState<WpPageOption[]>(() => {
    // Seed from cache so an immediately-opened popover isn't blank
    // for one render tick.
    const cached = wpPagesCache.get(wpPagesCacheKey(siteId, ""));
    return cached?.pages ?? [];
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // BL-4 — prefetch on focus / hover. No-op if cache is fresh; the
  // dedupe map blocks redundant concurrent fetches.
  const prefetchEmpty = useCallback(() => {
    if (disabled) return;
    const ctrl = new AbortController();
    void loadWpPages(siteId, "", ctrl.signal)
      .then((res) => {
        // Only seed component state if no operator-typed query has
        // landed in the meantime; otherwise we'd flash unsearched
        // results into a search context.
        setPages((prev) =>
          prev.length === 0 || res.fromCache ? res.pages : prev,
        );
      })
      .catch(() => {
        // Silent — the open-time fetch will surface errors loud.
      });
  }, [siteId, disabled]);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const { pages: next } = await loadWpPages(siteId, query, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setPages(next);
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
          onFocus={prefetchEmpty}
          onPointerEnter={prefetchEmpty}
          data-testid="post-parent-page-trigger"
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
