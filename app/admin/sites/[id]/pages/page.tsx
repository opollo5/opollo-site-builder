import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import { PagesTable } from "@/components/PagesTable";
import { Alert } from "@/components/ui/alert";
import { H1, Lead } from "@/components/ui/typography";
import { checkAdminAccess } from "@/lib/admin-gate";
import {
  LIST_PAGES_DEFAULT_LIMIT,
  listPagesForSite,
  type PageStatus,
} from "@/lib/pages";
import { getSite } from "@/lib/sites";
import { TEMPLATE_TYPES } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// /admin/sites/[id]/pages — M6-1.
//
// Site-scoped pages browser. Admin + operator visible (matches the
// /admin/sites/[id] detail page which is the only nav entry into
// here). Read-only; mutation paths land in M6-3.
//
// Query params:
//   status     "draft" | "published"
//   page_type  template enum
//   q          free-text search (title + slug, ILIKE)
//   page       1-indexed page number
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RawSearchParams = {
  [key: string]: string | string[] | undefined;
};

type ParsedParams = {
  status: PageStatus | null;
  page_type: string | null;
  query: string | null;
  page: number;
};

function parseSearchParams(raw: RawSearchParams): ParsedParams {
  const status =
    raw.status === "draft" || raw.status === "published"
      ? (raw.status as PageStatus)
      : null;
  const pageTypeRaw = typeof raw.page_type === "string" ? raw.page_type : null;
  const page_type =
    pageTypeRaw && (TEMPLATE_TYPES as readonly string[]).includes(pageTypeRaw)
      ? pageTypeRaw
      : null;
  const q =
    typeof raw.q === "string" && raw.q.trim().length > 0 ? raw.q.trim() : null;
  const pageRaw = typeof raw.page === "string" ? Number(raw.page) : 1;
  const page =
    Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  return { status, page_type, query: q, page };
}

function buildHref(
  siteId: string,
  base: ParsedParams,
  overrides: Partial<ParsedParams>,
): string {
  const merged = { ...base, ...overrides };
  const params = new URLSearchParams();
  if (merged.status) params.set("status", merged.status);
  if (merged.page_type) params.set("page_type", merged.page_type);
  if (merged.query) params.set("q", merged.query);
  if (merged.page > 1) params.set("page", String(merged.page));
  const qs = params.toString();
  const root = `/admin/sites/${siteId}/pages`;
  return qs.length > 0 ? `${root}?${qs}` : root;
}

export default async function SitePagesList({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: RawSearchParams;
}) {
  const access = await checkAdminAccess({
    requiredRoles: ["super_admin", "admin"],
    insufficientRoleRedirectTo: "/admin/sites",
  });
  if (access.kind === "redirect") redirect(access.to);

  if (!UUID_RE.test(params.id)) notFound();

  const siteRes = await getSite(params.id);
  if (!siteRes.ok) {
    if (siteRes.error.code === "NOT_FOUND") notFound();
    return (
      <Alert variant="destructive" title="Failed to load site">
        {siteRes.error.message}
      </Alert>
    );
  }
  const site = siteRes.data.site;

  const parsed = parseSearchParams(searchParams);
  const limit = LIST_PAGES_DEFAULT_LIMIT;
  const offset = (parsed.page - 1) * limit;

  const result = await listPagesForSite(params.id, {
    status: parsed.status ?? undefined,
    page_type: parsed.page_type ?? undefined,
    query: parsed.query ?? undefined,
    limit,
    offset,
  });

  if (!result.ok) {
    return (
      <Alert variant="destructive" title="Failed to load pages">
        {result.error.message}
      </Alert>
    );
  }

  const { items, total } = result.data;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.min(parsed.page, totalPages);
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + limit, total);

  return (
    <>
      <Breadcrumbs
        crumbs={[
          { label: "Sites", href: "/admin/sites" },
          { label: site.name, href: `/admin/sites/${params.id}` },
          { label: "Pages" },
        ]}
      />

      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <H1>Pages</H1>
          <Lead className="mt-0.5">
            {total === 0
              ? `No pages generated for ${site.name} yet.`
              : `${total} ${total === 1 ? "page" : "pages"} generated for ${site.name}.`}
          </Lead>
        </div>
        <Link
          href={`/admin/sites/${params.id}`}
          className="text-sm text-muted-foreground transition-smooth hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
        >
          ← Site detail
        </Link>
      </div>

      <form
        method="GET"
        action={`/admin/sites/${params.id}/pages`}
        className="mt-6 flex flex-wrap items-end gap-3 rounded-md border bg-muted/30 p-3"
      >
        <div className="flex flex-col gap-1">
          <label
            htmlFor="pages-q"
            className="text-sm font-medium text-muted-foreground"
          >
            Search
          </label>
          <input
            id="pages-q"
            type="search"
            name="q"
            defaultValue={parsed.query ?? ""}
            placeholder="managed IT"
            className="h-8 min-w-56 rounded border bg-background px-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="pages-status"
            className="text-sm font-medium text-muted-foreground"
          >
            Status
          </label>
          <select
            id="pages-status"
            name="status"
            defaultValue={parsed.status ?? ""}
            className="h-8 rounded border bg-background px-2 text-sm"
          >
            <option value="">Any</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="pages-type"
            className="text-sm font-medium text-muted-foreground"
          >
            Type
          </label>
          <select
            id="pages-type"
            name="page_type"
            defaultValue={parsed.page_type ?? ""}
            className="h-8 rounded border bg-background px-2 text-sm"
          >
            <option value="">Any</option>
            {TEMPLATE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="h-8 rounded bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Apply
        </button>
        {(parsed.query || parsed.status || parsed.page_type) && (
          <Link
            href={buildHref(params.id, parsed, {
              query: null,
              status: null,
              page_type: null,
              page: 1,
            })}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <div data-testid="pages-range">
          {total === 0 ? "0 pages" : `Showing ${rangeStart}–${rangeEnd} of ${total}`}
        </div>
        <div className="flex items-center gap-2">
          {currentPage > 1 && (
            <Link
              href={buildHref(params.id, parsed, { page: currentPage - 1 })}
              className="rounded border px-2 py-1 hover:bg-muted"
              rel="prev"
            >
              ← Previous
            </Link>
          )}
          {currentPage < totalPages && (
            <Link
              href={buildHref(params.id, parsed, { page: currentPage + 1 })}
              className="rounded border px-2 py-1 hover:bg-muted"
              rel="next"
            >
              Next →
            </Link>
          )}
        </div>
      </div>

      <div className="mt-3">
        <PagesTable
          items={items}
          siteId={params.id}
          backHref={buildHref(params.id, parsed, {})}
        />
      </div>
    </>
  );
}
