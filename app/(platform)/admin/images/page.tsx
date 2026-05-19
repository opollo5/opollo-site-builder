import Link from "next/link";
import { redirect } from "next/navigation";

import { ImagesTable, type ImagesFilterState } from "@/components/ImagesTable";
import { Alert } from "@/components/ui/alert";
import { TListWide } from "@/templates";
import { checkAdminAccess } from "@/lib/admin-gate";
import { deliveryUrl } from "@/lib/cloudflare-images";
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
    requiredRoles: ["super_admin", "admin"],
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

  const breadcrumb = [
    { label: "Admin", href: "/admin/sites" },
    { label: "Images" },
  ];

  if (!result.ok) {
    return (
      <TListWide title="Image library" breadcrumb={breadcrumb}>
        <Alert variant="destructive" title="Failed to load images">
          {result.error.message}
        </Alert>
      </TListWide>
    );
  }

  const { items: rawItems, total } = result.data;
  const items = rawItems.map((item) => ({
    ...item,
    previewUrl: item.cloudflare_id ? deliveryUrl(item.cloudflare_id, "public") : null,
  }));
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.min(parsed.page, totalPages);
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + limit, total);

  const subtitle = parsed.deleted
    ? `${total} archived ${total === 1 ? "image" : "images"} (soft-deleted). Restore from the detail view.`
    : `${total} ${total === 1 ? "image" : "images"} available to the chat builder. Filter by caption, tag, or source.`;

  const pagination = (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
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
  );

  return (
    <TListWide
      title="Image library"
      breadcrumb={breadcrumb}
      subtitle={subtitle}
      actions={
        <Link
          href={buildHref(parsed, { deleted: !parsed.deleted, page: 1 })}
          className="text-sm text-muted-foreground transition-smooth hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
        >
          {parsed.deleted ? "← Active images" : "View archived →"}
        </Link>
      }
      pagination={pagination}
    >
      <ImagesTable
        items={items}
        backHref={buildHref(parsed, {})}
        filterState={
          {
            query: parsed.query,
            tags: parsed.tags,
            source: parsed.source,
            deleted: parsed.deleted,
          } satisfies ImagesFilterState
        }
      />
    </TListWide>
  );
}
