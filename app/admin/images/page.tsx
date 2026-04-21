import Link from "next/link";
import { redirect } from "next/navigation";

import { ImagesTable } from "@/components/ImagesTable";
import { checkAdminAccess } from "@/lib/admin-gate";
import {
  LIST_IMAGES_DEFAULT_LIMIT,
  LIST_IMAGES_MAX_LIMIT,
  listImages,
  type ImageLibrarySource,
} from "@/lib/image-library";

// ---------------------------------------------------------------------------
// /admin/images — M5-1.
//
// Server-rendered list of the image library. Admin + operator visible
// (matches the RLS posture used by other admin surfaces; the images
// themselves are tenant-wide). Filter + search state rides on URL
// query params so a back-nav from the future detail page (M5-2)
// preserves it without extra plumbing.
//
// Query params:
//   q         free-text search (applied to image_library.search_tsv)
//   tag       repeated for AND semantics (tags @> $all)
//   source    one of istock | upload | generated
//   deleted   "1" flips the view to soft-deleted rows
//   page      1-indexed page number
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const SOURCE_VALUES: readonly ImageLibrarySource[] = [
  "istock",
  "upload",
  "generated",
];

type RawSearchParams = {
  [key: string]: string | string[] | undefined;
};

type ParsedParams = {
  query: string | null;
  tags: string[];
  source: ImageLibrarySource | null;
  deleted: boolean;
  page: number;
};

function parseSearchParams(raw: RawSearchParams): ParsedParams {
  const q =
    typeof raw.q === "string" && raw.q.trim().length > 0 ? raw.q.trim() : null;

  // `tag` can arrive as either a repeated URL param (?tag=a&tag=b, the
  // shape buildHref emits) or a single comma-separated string from the
  // form text input ("indoor, cat"). Normalise both to a trimmed, deduped
  // string array.
  const tagRaw = raw.tag;
  const tagStrings = Array.isArray(tagRaw)
    ? tagRaw.filter((t): t is string => typeof t === "string")
    : typeof tagRaw === "string"
      ? [tagRaw]
      : [];
  const tagSet = new Set<string>();
  for (const raw of tagStrings) {
    for (const piece of raw.split(",")) {
      const trimmed = piece.trim().toLowerCase();
      if (trimmed.length > 0) tagSet.add(trimmed);
    }
  }
  const tags = Array.from(tagSet);

  const sourceRaw = typeof raw.source === "string" ? raw.source : null;
  const source = (SOURCE_VALUES as readonly string[]).includes(sourceRaw ?? "")
    ? (sourceRaw as ImageLibrarySource)
    : null;

  const deleted = raw.deleted === "1";

  const pageRaw = typeof raw.page === "string" ? Number(raw.page) : 1;
  const page =
    Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;

  return { query: q, tags, source, deleted, page };
}

function buildHref(
  base: ParsedParams,
  overrides: Partial<ParsedParams>,
): string {
  const merged = { ...base, ...overrides };
  const params = new URLSearchParams();
  if (merged.query) params.set("q", merged.query);
  for (const tag of merged.tags) params.append("tag", tag);
  if (merged.source) params.set("source", merged.source);
  if (merged.deleted) params.set("deleted", "1");
  if (merged.page > 1) params.set("page", String(merged.page));
  const qs = params.toString();
  return qs.length > 0 ? `/admin/images?${qs}` : "/admin/images";
}

export default async function AdminImagesPage({
  searchParams,
}: {
  searchParams: RawSearchParams;
}) {
  const access = await checkAdminAccess({
    requiredRoles: ["admin", "operator"],
    insufficientRoleRedirectTo: "/admin/sites",
  });
  if (access.kind === "redirect") redirect(access.to);

  const parsed = parseSearchParams(searchParams);
  const limit = LIST_IMAGES_DEFAULT_LIMIT;
  const offset = (parsed.page - 1) * limit;

  const result = await listImages({
    query: parsed.query ?? undefined,
    tags: parsed.tags.length > 0 ? parsed.tags : undefined,
    source: parsed.source ?? undefined,
    deleted: parsed.deleted,
    limit,
    offset: offset > LIST_IMAGES_MAX_LIMIT * 1000 ? 0 : offset,
  });

  if (!result.ok) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
      >
        Failed to load images: {result.error.message}
      </div>
    );
  }

  const { items, total } = result.data;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.min(parsed.page, totalPages);
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + limit, total);

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Image library</h1>
          <p className="text-sm text-muted-foreground">
            {parsed.deleted
              ? "Archived images (soft-deleted). Restore from the detail view."
              : "Images available to the chat builder. Filter by caption, tags, or source."}
          </p>
        </div>
        <Link
          href={buildHref(parsed, { deleted: !parsed.deleted, page: 1 })}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {parsed.deleted ? "← Active images" : "View archived →"}
        </Link>
      </div>

      <form
        method="GET"
        action="/admin/images"
        className="mt-6 flex flex-wrap items-end gap-3 rounded-md border bg-muted/30 p-3"
      >
        <div className="flex flex-col gap-1">
          <label
            htmlFor="images-q"
            className="text-xs font-medium text-muted-foreground"
          >
            Search
          </label>
          <input
            id="images-q"
            type="search"
            name="q"
            defaultValue={parsed.query ?? ""}
            placeholder="cat in a windowsill"
            className="h-8 min-w-56 rounded border bg-background px-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="images-tag"
            className="text-xs font-medium text-muted-foreground"
          >
            Tags (comma-separated, all must match)
          </label>
          <input
            id="images-tag"
            type="text"
            name="tag"
            defaultValue={parsed.tags.join(", ")}
            placeholder="indoor, cat"
            className="h-8 min-w-48 rounded border bg-background px-2 text-sm"
            data-testid="images-tag-input"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="images-source"
            className="text-xs font-medium text-muted-foreground"
          >
            Source
          </label>
          <select
            id="images-source"
            name="source"
            defaultValue={parsed.source ?? ""}
            className="h-8 rounded border bg-background px-2 text-sm"
          >
            <option value="">Any</option>
            <option value="istock">iStock</option>
            <option value="upload">Upload</option>
            <option value="generated">Generated</option>
          </select>
        </div>
        {parsed.deleted && (
          <input type="hidden" name="deleted" value="1" />
        )}
        <button
          type="submit"
          className="h-8 rounded bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Apply
        </button>
        {(parsed.query || parsed.tags.length > 0 || parsed.source) && (
          <Link
            href={buildHref(
              { ...parsed, query: null, tags: [], source: null },
              { page: 1 },
            )}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <div data-testid="images-range">
          {total === 0
            ? "0 images"
            : `Showing ${rangeStart}–${rangeEnd} of ${total}`}
        </div>
        <div className="flex items-center gap-2">
          {currentPage > 1 && (
            <Link
              href={buildHref(parsed, { page: currentPage - 1 })}
              className="rounded border px-2 py-1 hover:bg-muted"
              rel="prev"
            >
              ← Previous
            </Link>
          )}
          {currentPage < totalPages && (
            <Link
              href={buildHref(parsed, { page: currentPage + 1 })}
              className="rounded border px-2 py-1 hover:bg-muted"
              rel="next"
            >
              Next →
            </Link>
          )}
        </div>
      </div>

      <div className="mt-3">
        <ImagesTable items={items} />
      </div>
    </>
  );
}
