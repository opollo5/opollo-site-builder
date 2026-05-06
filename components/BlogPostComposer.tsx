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
import { AlertTriangle, Check, ChevronDown } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/RichTextEditor";
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
  type BlogPostMetadata,
  type ParseSource,
} from "@/lib/blog-post-parser";
import { generateSlug } from "@/lib/slug";
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
//   - Progressive disclosure — parent page / featured image collapse
//     behind a "More options" toggle. Save Draft works without expanding.
// ---------------------------------------------------------------------------

const PARSE_DEBOUNCE_MS = 200;
const AUTOSAVE_DEBOUNCE_MS = 800;
const AUTOSAVE_STATUS_FRESH_MS = 1500;

// BL-3 — SEO recommendation envelopes. Advisory only; neither field is
// hard-capped. Matches Google / Bing SERPs as of mid-2025.
const TITLE_SEO_CAP = 60;
const META_TITLE_SEO_CAP = 60;
const META_DESCRIPTION_SEO_MIN = 120;
const META_DESCRIPTION_SEO_MAX = 160;

const SOURCE_HINTS: Record<ParseSource, string> = {
  yaml: "Auto-filled from YAML front-matter",
  inline: "Auto-filled from inline label",
  html: "Auto-filled from HTML meta",
  h1: "Auto-filled from first heading",
  first_paragraph: "Auto-filled from first paragraph",
  derived: "Derived from title",
  file: "Extracted from uploaded file",
  none: "",
};

// Extract first plain-text paragraph from HTML for meta-description seeding.
// Pure string walk — no DOM API, no regex replace — avoids both CodeQL rules
// (js/incomplete-multi-char-sanitization and js/xss).
function extractFirstParagraph(html: string): string {
  const pMatch = /<p[\s>]/.exec(html);
  if (!pMatch) return "";
  const tagEnd = html.indexOf(">", pMatch.index);
  if (tagEnd === -1) return "";
  const contentEnd = html.indexOf("</p>", tagEnd);
  if (contentEnd === -1) return "";
  let text = "";
  let inTag = false;
  let quote = "";
  for (let i = tagEnd + 1; i < contentEnd; i++) {
    const ch = html[i];
    if (inTag) {
      if (quote) { if (ch === quote) quote = ""; }
      else if (ch === '"' || ch === "'") { quote = ch; }
      else if (ch === ">") { inTag = false; }
    } else if (ch === "<") {
      inTag = true;
    } else {
      text += ch;
    }
  }
  return text.trim();
}

// Google SERP snippet preview — purely visual, no interaction.
function GoogleSnippetPreview({
  title,
  url,
  description,
}: {
  title: string;
  url: string;
  description: string;
}) {
  const displayTitle = title || "Post title";
  const displayDesc = description || "Meta description will appear here.";
  return (
    <div className="rounded border border-border bg-background p-3 font-sans text-sm">
      <div
        className="truncate text-base font-medium leading-snug text-[#1a0dab]"
        title={displayTitle}
      >
        {displayTitle.length > 60 ? displayTitle.slice(0, 60) + "…" : displayTitle}
      </div>
      <div className="mt-0.5 truncate text-xs text-[#006621]">{url}</div>
      <div className="mt-1 line-clamp-2 text-xs text-[#545454]">
        {displayDesc.length > 160 ? displayDesc.slice(0, 160) + "…" : displayDesc}
      </div>
    </div>
  );
}

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
    <span className="text-sm text-muted-foreground">{SOURCE_HINTS[source]}</span>
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

// Taxonomy option (categories / tags). Defined locally to avoid importing
// the server-only lib/wordpress module into a client component.
interface WpTaxonomyOption {
  id: number;
  name: string;
  slug: string;
  count: number;
  /** True for tags typed by the operator that don't exist in WP yet. */
  isNew?: boolean;
}

// Local shape — mirrors what Composer exported; kept so state references compile.
interface ComposerValue {
  text: string;
  file: File | null;
}

// Strip HTML tags for empty-content detection (Tiptap emits "<p></p>" for blank).
function isEditorEmpty(html: string): boolean {
  return html.replace(/<[^>]+>/g, "").trim().length === 0;
}

type PublishMode = "publish" | "draft" | "schedule";

function defaultScheduledAt(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(12, 0, 0, 0);
  return d.toISOString().slice(0, 16);
}

// BL-2 autosave shape.
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
  publishMode?: PublishMode;
  scheduledAt?: string;
  selectedCategories?: WpTaxonomyOption[];
  selectedTags?: WpTaxonomyOption[];
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
  const [parentPage, setParentPage] = useState<WpPageOption | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [lastParse, setLastParse] = useState<BlogPostMetadata | null>(null);
  const [featuredImage, setFeaturedImage] = useState<ImagePickerEntry | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [autosave, setAutosave] = useState<AutosaveState>({ kind: "idle" });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<DraftSnapshot | null>(null);
  const [draftRestoredAt, setDraftRestoredAt] = useState<number | null>(null);
  const [fileReadError, setFileReadError] = useState<string | null>(null);
  const [permalinkStructure, setPermalinkStructure] = useState<string | null>(null);
  const [siteWpUrl, setSiteWpUrl] = useState<string | null>(null);
  const [siteName, setSiteName] = useState<string | null>(null);
  const [siteLoading, setSiteLoading] = useState(true);
  // Fix 5 — publish scheduling.
  const [publishMode, setPublishMode] = useState<PublishMode>("draft");
  const [scheduledAt, setScheduledAt] = useState<string>(defaultScheduledAt);
  // Fix 6 — WP categories + tags.
  const [selectedCategories, setSelectedCategories] = useState<WpTaxonomyOption[]>([]);
  const [selectedTags, setSelectedTags] = useState<WpTaxonomyOption[]>([]);
  // Hydration guard — restore-from-localStorage runs once, AFTER mount.
  const restoredRef = useRef(false);

  // BL-2 — check for a saved draft on mount; show a banner rather than silently pre-filling.
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
      setPendingDraft(parsed);
    } catch {
      try {
        window.localStorage.removeItem(draftStorageKey(siteId));
      } catch {}
    } finally {
      restoredRef.current = true;
    }
  }, [siteId]);

  // Read attached file content into composerValue.text.
  useEffect(() => {
    const file = composerValue.file;
    if (!file) return;
    setFileReadError(null);
    let cancelled = false;

    void (async () => {
      try {
        let text: string;
        const lower = file.name.toLowerCase();
        const isDocx =
          lower.endsWith(".docx") ||
          file.type ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

        if (isDocx) {
          const mammoth = await import("mammoth");
          const buf = await file.arrayBuffer();
          const result = await mammoth.convertToHtml(
            { arrayBuffer: buf },
            {
              styleMap: [
                "p[style-name='Heading 1'] => h1:fresh",
                "p[style-name='Heading 2'] => h2:fresh",
                "p[style-name='Heading 3'] => h3:fresh",
                "p[style-name='Normal'] => p:fresh",
              ],
            },
          );
          if (!cancelled && title.value.trim().length === 0) {
            const h1Match = /<h1[^>]*>(.*?)<\/h1>/i.exec(result.value);
            if (h1Match) {
              const h1Text = h1Match[1].replace(/<[^>]+>/g, "").trim();
              if (h1Text) {
                setTitle({ value: h1Text, source: "file", touched: false });
              }
            }
          }
          text = result.value;
        } else {
          text = await file.text();
        }

        if (!cancelled) {
          setComposerValue((prev) => ({ ...prev, text }));
        }
      } catch (err) {
        if (!cancelled) {
          setFileReadError(
            `Could not read file: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerValue.file]);

  // Fix 7 — fetch site name + permalink structure on mount.
  useEffect(() => {
    setSiteLoading(true);
    void (async () => {
      try {
        const [permRes, siteRes] = await Promise.all([
          fetch(`/api/sites/${siteId}/permalink-structure`, { cache: "no-store" }),
          fetch(`/api/sites/${siteId}`, { cache: "no-store" }),
        ]);
        const permPay = (await permRes.json().catch(() => null)) as
          | { ok: true; data: { permalink_structure: string | null } }
          | null;
        if (permPay?.ok) setPermalinkStructure(permPay.data.permalink_structure);

        const sitePay = (await siteRes.json().catch(() => null)) as
          | { ok: true; data: { site: { wp_url: string; name: string } } }
          | null;
        if (sitePay?.ok) {
          setSiteWpUrl(sitePay.data.site.wp_url.replace(/\/$/, ""));
          setSiteName(sitePay.data.site.name ?? null);
        }
      } catch {
        // Non-fatal — site indicator + URL preview simply won't render.
      } finally {
        setSiteLoading(false);
      }
    })();
  }, [siteId]);

  // Fix 2 — auto-generate slug from title when slug is blank and untouched.
  useEffect(() => {
    if (!slug.touched && slug.value === "" && title.value.trim().length > 0) {
      setSlug({ value: generateSlug(title.value), source: "derived", touched: false });
    }
  // Only re-run when title changes; slug setter is stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title.value]);

  // Issue 7 — auto-populate SEO title from "{Post title} - {Site name}" when
  // the operator hasn't touched the field and the parser didn't fill it.
  useEffect(() => {
    if (!metaTitle.touched && metaTitle.value === "" && title.value.trim() && siteName) {
      setMetaTitle({ value: `${title.value.trim()} - ${siteName}`, source: "derived", touched: false });
    }
  // Re-run only when title or siteName changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title.value, siteName]);

  // Issue 7 — auto-populate meta description from first paragraph when the
  // operator hasn't touched the field and the parser didn't fill it.
  useEffect(() => {
    if (!metaDescription.touched && metaDescription.value === "") {
      const firstP = extractFirstParagraph(composerValue.text);
      if (firstP) {
        setMetaDescription({ value: firstP, source: "first_paragraph", touched: false });
      }
    }
  // Re-run when composerValue.text changes (debounced upstream via parse effect).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerValue.text]);

  // Debounced re-parse on every text change.
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

  // Featured image is now outside the AdvancedDisclosure — no need to auto-open.

  // BL-2 — debounced autosave to localStorage.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!restoredRef.current) return;
    if (submitting) return;
    if (
      isEditorEmpty(composerValue.text) &&
      title.value.length === 0 &&
      slug.value.length === 0 &&
      metaTitle.value.length === 0 &&
      metaDescription.value.length === 0 &&
      parentPage === null &&
      featuredImage === null &&
      selectedCategories.length === 0 &&
      selectedTags.length === 0
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
        publishMode,
        scheduledAt,
        selectedCategories,
        selectedTags,
      };
      try {
        window.localStorage.setItem(
          draftStorageKey(siteId),
          JSON.stringify(snapshot),
        );
        setAutosave({ kind: "saved", at: snapshot.savedAt });
      } catch {
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
    publishMode,
    scheduledAt,
    selectedCategories,
    selectedTags,
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
    setPublishMode("draft");
    setScheduledAt(defaultScheduledAt());
    setSelectedCategories([]);
    setSelectedTags([]);
    setPendingDraft(null);
  }, [siteId]);

  const restoreDraft = useCallback(() => {
    if (!pendingDraft) return;
    if (typeof pendingDraft.composerText === "string") {
      setComposerValue({ text: pendingDraft.composerText, file: null });
    }
    if (pendingDraft.title) setTitle(pendingDraft.title);
    if (pendingDraft.slug) setSlug(pendingDraft.slug);
    if (pendingDraft.metaTitle) setMetaTitle(pendingDraft.metaTitle);
    if (pendingDraft.metaDescription) setMetaDescription(pendingDraft.metaDescription);
    if (pendingDraft.parentPage !== undefined) setParentPage(pendingDraft.parentPage);
    if (pendingDraft.featuredImage !== undefined) setFeaturedImage(pendingDraft.featuredImage);
    if (pendingDraft.publishMode) setPublishMode(pendingDraft.publishMode);
    if (pendingDraft.scheduledAt) setScheduledAt(pendingDraft.scheduledAt);
    if (pendingDraft.selectedCategories) setSelectedCategories(pendingDraft.selectedCategories);
    if (pendingDraft.selectedTags) setSelectedTags(pendingDraft.selectedTags);
    setDraftRestoredAt(pendingDraft.savedAt);
    if (pendingDraft.parentPage) setShowAdvanced(true);
    setPendingDraft(null);
  }, [pendingDraft]);

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

  const scheduleIsValid =
    publishMode !== "schedule" || scheduledAt.length > 0;

  const canSaveDraft =
    !submitting &&
    titleIsValid &&
    slugIsValid &&
    !isEditorEmpty(composerValue.text) &&
    scheduleIsValid;

  const canPublish =
    canSaveDraft &&
    metaTitleIsValid &&
    metaDescriptionIsValid;

  const publishMissingImage = canPublish && featuredImage === null;

  // BL-8 — ⌘S / Ctrl+S triggers Save draft (draft, always safe).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isCmdS =
        (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === "s";
      if (!isCmdS) return;
      if (!canSaveDraft) return;
      e.preventDefault();
      const formEl = document.getElementById(
        `blog-post-composer-form-${siteId}`,
      ) as HTMLFormElement | null;
      formEl?.requestSubmit();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSaveDraft, siteId]);

  async function buildCreateBody(forceAsDraft = false) {
    const newTagNames = selectedTags
      .filter((t) => t.isNew)
      .map((t) => t.name);
    const existingTagIds = selectedTags
      .filter((t) => !t.isNew)
      .map((t) => t.id);
    const newCategoryNames = selectedCategories
      .filter((c) => c.isNew)
      .map((c) => c.name);
    const existingCategoryIds = selectedCategories
      .filter((c) => !c.isNew)
      .map((c) => c.id);
    const mode = forceAsDraft ? "draft" : publishMode;
    return {
      title: title.value.trim(),
      slug: slug.value.trim(),
      excerpt:
        metaDescription.value.trim().length > 0
          ? metaDescription.value.trim()
          : null,
      meta_title: metaTitle.value.trim() || null,
      status: mode === "schedule" ? "scheduled" : "draft",
      scheduled_at: mode === "schedule" ? scheduledAt : null,
      wp_category_ids: existingCategoryIds,
      wp_tag_ids: existingTagIds,
      ...(newCategoryNames.length > 0 ? { wp_new_category_names: newCategoryNames } : {}),
      ...(newTagNames.length > 0 ? { wp_new_tag_names: newTagNames } : {}),
      metadata: lastParse ?? null,
      featured_image_id: featuredImage?.id ?? null,
      // Always persist composer content as generated_html so the detail
      // page's Publish button is enabled regardless of save mode.
      ...(!isEditorEmpty(composerValue.text)
        ? { generated_html: composerValue.text }
        : {}),
    };
  }

  async function submitToOpollo(forceAsDraft = false): Promise<{ id: string; edit_url: string } | null> {
    const body = await buildCreateBody(forceAsDraft);
    const baseSlug = body.slug as string;
    const MAX_ATTEMPTS = 5;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const attemptSlug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
      const res = await fetch(`/api/sites/${siteId}/posts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, slug: attemptSlug }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { ok: true; data: { id: string; edit_url: string } }
        | { ok: false; error: { code: string; message: string } }
        | null;

      if (payload?.ok) {
        if (attemptSlug !== baseSlug) {
          setSlug({ value: attemptSlug, source: "derived", touched: true });
        }
        return payload.data;
      }

      const code = payload?.ok === false ? payload.error.code : "INTERNAL_ERROR";
      if (code === "UNIQUE_VIOLATION" && attempt < MAX_ATTEMPTS - 1) continue;

      const fallback =
        payload?.ok === false
          ? payload.error.message
          : `Save failed (HTTP ${res.status}).`;
      setFormError(ERROR_TRANSLATIONS[code] ?? fallback);
      return null;
    }

    setFormError("Could not find a unique slug. Edit the URL slug and try again.");
    return null;
  }

  async function handlePublishToWp(postId: string): Promise<boolean> {
    const res = await fetch(`/api/sites/${siteId}/posts/${postId}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expected_version_lock: 0 }),
    });
    const payload = (await res.json().catch(() => null)) as
      | { ok: true; data: unknown }
      | { ok: false; error: { code: string; message: string } }
      | null;
    if (!payload?.ok) {
      const code = payload?.ok === false ? payload.error.code : "WP_API_ERROR";
      const fallback =
        payload?.ok === false
          ? payload.error.message
          : `Publish failed (HTTP ${res.status}). Post saved to Opollo — open the post to retry.`;
      setFormError(ERROR_TRANSLATIONS[code] ?? fallback);
      return false;
    }
    return true;
  }

  async function handlePrimarySubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    if (publishMode === "schedule" && !scheduledAt) {
      setFormError("Please pick a date and time to schedule this post.");
      return;
    }

    setSubmitting(true);
    try {
      const postData = await submitToOpollo();
      if (!postData) return;

      if (publishMode === "publish") {
        const wpOk = await handlePublishToWp(postData.id);
        if (!wpOk) return; // Error shown in form; post is saved as draft
      }

      try { window.localStorage.removeItem(draftStorageKey(siteId)); } catch {}
      router.push(postData.edit_url);
    } catch (err) {
      setFormError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveToOpollo(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    setFormError(null);
    if (!canSaveDraft) return;
    setSubmitting(true);
    try {
      const postData = await submitToOpollo(true);
      if (!postData) return;
      try { window.localStorage.removeItem(draftStorageKey(siteId)); } catch {}
      router.push(postData.edit_url);
    } catch (err) {
      setFormError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  // Fix 8 — context-sensitive primary button labels.
  const primaryLabel =
    publishMode === "publish"
      ? "Publish to WordPress"
      : publishMode === "schedule"
        ? "Schedule Post"
        : "Save as Draft";
  const primaryDisabled = publishMode === "publish" ? !canPublish : !canSaveDraft;

  return (
    <form
      id={`blog-post-composer-form-${siteId}`}
      onSubmit={handlePrimarySubmit}
      className="lg:grid lg:grid-cols-[1fr_300px] lg:items-start lg:gap-8"
    >
      {/* ── LEFT: title + editor ── */}
      <div className="space-y-4">
        {!siteLoading && !siteWpUrl && (
          <Alert variant="destructive" className="flex items-start gap-2">
            <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              No WordPress site connected — this post will be saved as a draft in Opollo only.{" "}
              <a
                href={`/admin/sites/${siteId}/settings`}
                className="underline underline-offset-2 hover:text-inherit"
              >
                Connect a site
              </a>
            </span>
          </Alert>
        )}
        {pendingDraft && (
          <DraftRestoreBanner
            savedAt={pendingDraft.savedAt}
            onRestore={restoreDraft}
            onDiscard={discardDraft}
          />
        )}

        {/* Prominent title field — mirrors WordPress block editor */}
        <div>
          <label htmlFor="post-title" className="sr-only">
            Title
          </label>
          <Input
            id="post-title"
            className="rounded-none border-0 border-b px-0 text-2xl font-bold shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/50"
            placeholder="Post title"
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
            <TitleLengthHint length={title.value.length} valid={titleIsValid} />
          </div>
        </div>

        {/* Body editor + file attach */}
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <label className="block text-sm font-medium">Post content</label>
            <label
              htmlFor="post-file-attach"
              className={cn(
                "cursor-pointer text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline",
                submitting && "pointer-events-none opacity-50",
              )}
              title="Attach Markdown, HTML, plain text, or Word (.docx). Max 10 MB."
            >
              Attach file
              <input
                id="post-file-attach"
                type="file"
                accept=".md,.html,.txt,.docx,text/markdown,text/html,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="sr-only"
                disabled={submitting}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setFileReadError(null);
                    setComposerValue((prev) => ({ ...prev, file: f }));
                  }
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <RichTextEditor
            value={composerValue.text}
            onChange={(html) => setComposerValue((prev) => ({ ...prev, text: html }))}
            placeholder={`Type, paste, or drop your post.\n\nA YAML front-matter block, inline labels, or HTML meta tags will pre-fill the metadata fields below.`}
            disabled={submitting}
            className="mt-1"
          />
          {fileReadError && (
            <p className="mt-1 text-sm text-destructive" role="alert">
              {fileReadError}
            </p>
          )}
        </div>

        {formError && <Alert variant="destructive">{formError}</Alert>}

        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <SaveStatus
            autosave={autosave}
            restoredAt={draftRestoredAt}
            onDiscard={discardDraft}
          />
        </div>
      </div>

      {/* ── RIGHT: document sidebar ── */}
      <aside
        className="mt-6 space-y-3 lg:mt-0"
        aria-label="Post settings"
        data-testid="post-sidebar"
      >
        {/* Publish panel */}
        <SidebarPanel title="Publish" defaultOpen testId="sidebar-publish">
          {siteWpUrl && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <span className="shrink-0">Publishing to:</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                {(() => {
                  try {
                    return new URL(siteWpUrl).hostname;
                  } catch {
                    return siteWpUrl;
                  }
                })()}
              </span>
              <a
                href="/admin/posts/new"
                className="shrink-0 text-xs underline underline-offset-2 hover:text-foreground"
                title={`Change WordPress site (currently ${siteName ?? siteWpUrl})`}
              >
                Change
              </a>
            </div>
          )}

          <div>
            <p className="mb-2 text-sm font-medium">Status</p>
            <div className="space-y-1.5">
              {(["draft", "publish", "schedule"] as const).map((mode) => (
                <label
                  key={mode}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <input
                    type="radio"
                    name={`publish-mode-${siteId}`}
                    value={mode}
                    checked={publishMode === mode}
                    onChange={() => setPublishMode(mode)}
                    disabled={submitting}
                    className="accent-primary"
                  />
                  {mode === "draft"
                    ? "Save as draft"
                    : mode === "publish"
                      ? "Publish immediately"
                      : "Schedule for later"}
                </label>
              ))}
            </div>
            {publishMode === "schedule" && (
              <div className="mt-3">
                <label
                  htmlFor="post-scheduled-at"
                  className="block text-sm font-medium"
                >
                  Publish at
                </label>
                <Input
                  id="post-scheduled-at"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="mt-1 w-full"
                  disabled={submitting}
                />
              </div>
            )}
          </div>

          {publishMode === "publish" && !canPublish && canSaveDraft && (
            <p className="text-sm text-muted-foreground">
              Add SEO title and meta description to enable publishing.
            </p>
          )}

          {publishMode === "publish" && publishMissingImage && (
            <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
              No featured image set. Posts without a featured image may not display correctly in WordPress.
            </p>
          )}

          <div className="flex flex-col gap-2">
            <Button
              type="submit"
              className="w-full"
              disabled={primaryDisabled || submitting}
              title={
                publishMode === "publish" && !canPublish
                  ? "Fill in SEO title and meta description to publish."
                  : undefined
              }
            >
              {submitting ? "Saving…" : primaryLabel}
            </Button>
            {publishMode !== "draft" && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={!canSaveDraft || submitting}
                onClick={handleSaveToOpollo}
                title="Save as draft in Opollo. Does not publish to WordPress."
              >
                {submitting ? "Saving…" : "Save draft"}
              </Button>
            )}
          </div>

          <p
            aria-hidden
            className="flex items-center justify-center gap-0.5 text-sm text-muted-foreground"
          >
            <kbd className="rounded border bg-muted px-1 font-mono text-xs">⌘</kbd>
            <kbd className="rounded border bg-muted px-1 font-mono text-xs">S</kbd>
            <span className="ml-1">to save draft</span>
          </p>
        </SidebarPanel>

        {/* Permalink panel */}
        <SidebarPanel title="Permalink" defaultOpen testId="sidebar-permalink">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor="post-slug" className="block text-sm font-medium">
              URL slug
            </label>
            {title.value.trim().length > 0 && (
              <button
                type="button"
                onClick={() =>
                  setSlug({
                    value: generateSlug(title.value),
                    source: "derived",
                    touched: true,
                  })
                }
                disabled={submitting}
                className="rounded-sm text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Regenerate
              </button>
            )}
          </div>
          <Input
            id="post-slug"
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
              if (slug.value && !slugIsValid) {
                setSlug({ value: generateSlug(slug.value), source: "derived", touched: true });
              }
            }}
            disabled={submitting}
            maxLength={100}
            aria-invalid={!slugIsValid}
          />
          <div className="space-y-0.5">
            <div className="flex items-center justify-between gap-2">
              <SourceHint source={slug.source} />
              {!slugIsValid && slug.value.length > 0 && (
                <span className="text-sm text-destructive">
                  Lowercase, numbers, dashes only.
                </span>
              )}
            </div>
            <PermalinkPreview
              structure={permalinkStructure}
              wpUrl={siteWpUrl}
              slug={slug.value}
            />
          </div>
        </SidebarPanel>

        {/* Categories panel */}
        <SidebarPanel title="Categories" defaultOpen testId="sidebar-categories">
          <WpTaxonomyCombobox
            siteId={siteId}
            type="categories"
            value={selectedCategories}
            onChange={setSelectedCategories}
            disabled={submitting}
          />
        </SidebarPanel>

        {/* Tags panel */}
        <SidebarPanel title="Tags" defaultOpen testId="sidebar-tags">
          <WpTaxonomyCombobox
            siteId={siteId}
            type="tags"
            value={selectedTags}
            onChange={setSelectedTags}
            disabled={submitting}
          />
        </SidebarPanel>

        {/* Featured image panel */}
        <SidebarPanel title="Featured image" defaultOpen testId="sidebar-featured-image">
          {featuredImage?.delivery_url ? (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={featuredImage.delivery_url}
                alt={featuredImage.alt_text ?? featuredImage.caption ?? ""}
                className="aspect-video w-full rounded-md border object-cover"
              />
              <p
                className="truncate text-sm font-medium"
                title={featuredImage.caption ?? featuredImage.filename ?? ""}
              >
                {featuredImage.caption ?? featuredImage.filename ?? "Untitled"}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPickerOpen(true)}
                  disabled={submitting}
                >
                  Replace
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setFeaturedImage(null)}
                  disabled={submitting}
                >
                  Remove
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <p className="mb-2 text-sm text-muted-foreground">
                Required when publishing.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setPickerOpen(true)}
                disabled={submitting}
              >
                Set featured image
              </Button>
            </div>
          )}
        </SidebarPanel>

        {/* SEO panel — open by default; auto-populates from title + first paragraph */}
        <SidebarPanel title="SEO" defaultOpen={true} testId="sidebar-seo">
          <div className="space-y-3">
            <div>
              <label htmlFor="post-meta-title" className="block text-sm font-medium">
                SEO title
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
                htmlFor="post-meta-description"
                className="block text-sm font-medium"
              >
                Meta description
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
                aria-invalid={metaDescription.value.length > 0 && !metaDescriptionIsValid}
              />
              <div className="mt-1 flex items-center justify-between gap-2 text-sm">
                <SourceHint source={metaDescription.source} />
                <MetaDescriptionLengthHint length={metaDescription.value.length} />
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Search preview
              </p>
              <GoogleSnippetPreview
                title={metaTitle.value || title.value}
                url={
                  siteWpUrl && slug.value
                    ? `${siteWpUrl.replace(/\/$/, "")}/${slug.value}/`
                    : siteWpUrl ?? "https://example.com/"
                }
                description={metaDescription.value}
              />
            </div>
          </div>
        </SidebarPanel>

        {/* Parent page panel — collapsed by default (optional, rare) */}
        <SidebarPanel title="Parent page" defaultOpen={false} testId="sidebar-parent-page">
          <WpPageCombobox
            siteId={siteId}
            value={parentPage}
            onChange={setParentPage}
            disabled={submitting}
            triggerId="post-parent-page"
          />
          <p className="mt-1 text-sm text-muted-foreground">
            Where this post will live in the WP site tree.
          </p>
        </SidebarPanel>
      </aside>

      <ImagePickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(image) => setFeaturedImage(image)}
        suggestionContext={
          title.value.trim().length > 0 || !isEditorEmpty(composerValue.text)
            ? `${title.value} ${title.value} ${title.value} ${composerValue.text.replace(/<[^>]+>/g, " ").slice(0, 400)}`.trim()
            : null
        }
      />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Permalink URL preview below the slug field.
// ---------------------------------------------------------------------------

const PERMALINK_TOKEN_DATE = new Date();

function substitutePermalinkTokens(
  structure: string,
  slug: string,
): string {
  const y = PERMALINK_TOKEN_DATE.getFullYear().toString();
  const m = String(PERMALINK_TOKEN_DATE.getMonth() + 1).padStart(2, "0");
  const d = String(PERMALINK_TOKEN_DATE.getDate()).padStart(2, "0");
  return structure
    .replace(/%year%/g, y)
    .replace(/%monthnum%/g, m)
    .replace(/%month%/g, m)
    .replace(/%day%/g, d)
    .replace(/%postname%/g, slug || "your-slug")
    .replace(/%post_id%/g, "1")
    .replace(/%category%/g, "uncategorized")
    .replace(/%author%/g, "author");
}

function PermalinkPreview({
  structure,
  wpUrl,
  slug,
}: {
  structure: string | null;
  wpUrl: string | null;
  slug: string;
}) {
  if (!structure || !wpUrl || !slug) return null;
  const path = substitutePermalinkTokens(structure, slug);
  const preview = `${wpUrl}${path}`;
  return (
    <span
      className="block truncate font-mono text-xs text-muted-foreground"
      title={preview}
    >
      {preview}
    </span>
  );
}

// ---------------------------------------------------------------------------
// BL-3 — Inline length hints. Pure presentational.
// ---------------------------------------------------------------------------

function TitleLengthHint({
  length,
  valid,
}: {
  length: number;
  valid: boolean;
}) {
  if (!valid) {
    return (
      <span className="text-sm text-destructive">Title required.</span>
    );
  }
  if (length === 0) return null;
  const overSeoCap = length > TITLE_SEO_CAP;
  return (
    <span
      data-testid="post-title-length-hint"
      className={cn(
        "text-sm",
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
        "text-sm",
        overSeoCap ? "text-warning" : "text-muted-foreground",
      )}
    >
      {length}/{META_TITLE_SEO_CAP}
      {overSeoCap && " · search will truncate"}
    </span>
  );
}

function MetaDescriptionLengthHint({ length }: { length: number }) {
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
// WordPress-style collapsible sidebar panel.
// ---------------------------------------------------------------------------

function SidebarPanel({
  title,
  defaultOpen = true,
  testId,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  testId?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className="overflow-hidden rounded-md border bg-card"
      data-testid={testId}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-semibold transition-colors hover:bg-muted/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {title}
        <ChevronDown
          aria-hidden
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="space-y-3 border-t px-4 py-3">{children}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BL-2 — Pending-draft banner (replaces silent pre-fill).
// ---------------------------------------------------------------------------

function DraftRestoreBanner({
  savedAt,
  onRestore,
  onDiscard,
}: {
  savedAt: number;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  return (
    <div
      data-testid="draft-restore-banner"
      role="alert"
      className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800/40 dark:bg-amber-900/20"
    >
      <span className="text-amber-900 dark:text-amber-200">
        You have an unsaved draft from{" "}
        {formatRelativeTime(new Date(savedAt).toISOString())}.
      </span>
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          data-testid="draft-restore-button"
          onClick={onRestore}
          className="font-medium text-amber-900 underline underline-offset-2 hover:text-amber-700 dark:text-amber-200 dark:hover:text-amber-100"
        >
          Restore
        </button>
        <span aria-hidden className="text-amber-400">
          ·
        </span>
        <button
          type="button"
          data-testid="draft-discard-button"
          onClick={onDiscard}
          className="text-amber-700 underline underline-offset-2 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100"
        >
          Discard
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BL-2 — Save status indicator.
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
// Fix 6 — WpTaxonomyCombobox: multi-select for categories or tags.
// ---------------------------------------------------------------------------

function WpTaxonomyCombobox({
  siteId,
  type,
  value,
  onChange,
  disabled,
}: {
  siteId: string;
  type: "categories" | "tags";
  value: WpTaxonomyOption[];
  onChange: (next: WpTaxonomyOption[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [options, setOptions] = useState<WpTaxonomyOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/sites/${siteId}/wp-taxonomies?type=${type}`,
          { cache: "no-store" },
        );
        const payload = (await res.json().catch(() => null)) as
          | { ok: true; data: { items: WpTaxonomyOption[] } }
          | { ok: false; error: { message: string } }
          | null;
        if (!cancelled) {
          if (payload?.ok) {
            setOptions(payload.data.items);
          } else {
            setError(
              payload?.ok === false
                ? payload.error.message
                : `Failed to load ${type}.`,
            );
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [siteId, type]);

  const selectedIds = useMemo(() => new Set(value.map((v) => v.id)), [value]);
  const label = type === "categories" ? "category" : "tag";
  const placeholder = loading ? `Loading ${type}…` : `Pick ${type}…`;

  const canCreateNew =
    inputValue.trim().length > 0 &&
    !options.some(
      (o) => o.name.toLowerCase() === inputValue.trim().toLowerCase(),
    ) &&
    !value.some(
      (v) => v.name.toLowerCase() === inputValue.trim().toLowerCase(),
    );

  function addNew() {
    const name = inputValue.trim();
    if (!name) return;
    const newItem: WpTaxonomyOption = {
      id: -Date.now(),
      name,
      slug: name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
      count: 0,
      isNew: true,
    };
    onChange([...value, newItem]);
    setInputValue("");
  }

  return (
    <Popover open={open} onOpenChange={(next) => !disabled && setOpen(next)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="mt-1 flex min-h-10 w-full items-start justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm transition-smooth focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span
            className={cn(
              "flex min-h-6 flex-1 flex-wrap gap-1",
              value.length === 0 && "text-muted-foreground",
            )}
          >
            {value.length > 0
              ? value.map((v) => (
                  <span
                    key={v.id}
                    className={cn(
                      "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium",
                      v.isNew ? "bg-primary/10 text-primary" : "bg-muted",
                    )}
                  >
                    {v.isNew && <span aria-hidden>+</span>}
                    {v.name}
                  </span>
                ))
              : placeholder}
          </span>
          <ChevronDown
            aria-hidden
            className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] max-h-60 overflow-y-auto p-0"
      >
        <Command shouldFilter={true}>
          <CommandInput
            placeholder={`Search or create ${label}…`}
            value={inputValue}
            onValueChange={setInputValue}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canCreateNew) {
                e.preventDefault();
                addNew();
              }
            }}
          />
          <CommandList>
            {error && (
              <div role="alert" className="px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            {canCreateNew && (
              <CommandItem
                value={`__new__${inputValue}`}
                onSelect={addNew}
                className="text-primary"
              >
                <span className="mr-2 text-primary">+</span>
                Add {label} &ldquo;{inputValue.trim()}&rdquo;
              </CommandItem>
            )}
            <CommandEmpty>
              {loading
                ? "Loading…"
                : `Type a name to search or create a ${label}.`}
            </CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option.id}
                value={`${option.name} ${option.slug}`}
                onSelect={() => {
                  if (selectedIds.has(option.id)) {
                    onChange(value.filter((v) => v.id !== option.id));
                  } else {
                    onChange([...value, option]);
                  }
                }}
              >
                <Check
                  aria-hidden
                  className={cn(
                    "mr-2 h-4 w-4 shrink-0",
                    selectedIds.has(option.id) ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="flex-1 truncate">{option.name}</span>
                {option.count > 0 && (
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                    {option.count}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// BP-8 / BL-4 — WP parent-page combobox.
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
    const cached = wpPagesCache.get(wpPagesCacheKey(siteId, ""));
    return cached?.pages ?? [];
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prefetchEmpty = useCallback(() => {
    if (disabled) return;
    const ctrl = new AbortController();
    void loadWpPages(siteId, "", ctrl.signal)
      .then((res) => {
        setPages((prev) =>
          prev.length === 0 || res.fromCache ? res.pages : prev,
        );
      })
      .catch(() => {});
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
                className="px-3 py-2 text-sm text-destructive"
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
                <span className="ml-2 shrink-0 text-sm text-muted-foreground">
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
