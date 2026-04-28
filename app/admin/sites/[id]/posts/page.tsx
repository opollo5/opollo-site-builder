import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import { checkAdminAccess } from "@/lib/admin-gate";
import {
  LIST_POSTS_DEFAULT_LIMIT,
  listPostsForSite,
  type PostStatus,
} from "@/lib/posts";
import { getSite } from "@/lib/sites";

// ---------------------------------------------------------------------------
// /admin/sites/[id]/posts — M13-4.
//
// Site-scoped posts browser. Admin + operator visible. Mirrors the
// /admin/sites/[id]/pages surface shipped in M6-1 so the operator's
// mental model is consistent across content types.
//
// Query params:
//   status   "draft" | "published" | "scheduled"
//   q        free-text search (title + slug, ILIKE)
//   page     1-indexed page number
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RawSearchParams = { [key: string]: string | string[] | undefined };

type ParsedParams = {
  status: PostStatus | null;
  query: string | null;
  page: number;
};

function parseSearchParams(raw: RawSearchParams): ParsedParams {
  const statusRaw = typeof raw.status === "string" ? raw.status : null;
  const status: PostStatus | null =
    statusRaw === "draft" ||
    statusRaw === "published" ||
    statusRaw === "scheduled"
      ? statusRaw
      : null;
  const q =
    typeof raw.q === "string" && raw.q.trim().length > 0 ? raw.q.trim() : null;
  const pageRaw = typeof raw.page === "string" ? Number(raw.page) : 1;
  const page =
    Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  return { status, query: q, page };
}

function buildHref(
  siteId: string,
  base: ParsedParams,
  overrides: Partial<ParsedParams>,
): string {
  const merged = { ...base, ...overrides };
  const params = new URLSearchParams();
  if (merged.status) params.set("status", merged.status);
  if (merged.query) params.set("q", merged.query);
  if (merged.page > 1) params.set("page", String(merged.page));
  const qs = params.toString();
  const root = `/admin/sites/${siteId}/posts`;
  return qs.length > 0 ? `${root}?${qs}` : root;
}

function statusPill(status: PostStatus): { label: string; cls: string } {
  if (status === "published") {
    return { label: "Published", cls: "bg-emerald-500/10 text-emerald-700" };
  }
  if (status === "scheduled") {
    return { label: "Scheduled", cls: "bg-primary/10 text-primary" };
  }
  return { label: "Draft", cls: "bg-muted text-muted-foreground" };
}

export default async function SitePostsList({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: RawSearchParams;
}) {
  const access = await checkAdminAccess({
    requiredRoles: ["admin", "operator"],
    insufficientRoleRedirectTo: "/admin/sites",
  });
  if (access.kind === "redirect") redirect(access.to);

  if (!UUID_RE.test(params.id)) notFound();

  const siteRes = await getSite(params.id);
  if (!siteRes.ok) {
    if (siteRes.error.code === "NOT_FOUND") notFound();
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
      >
        Failed to load site: {siteRes.error.message}
      </div>
    );
  }
  const site = siteRes.data.site;

  const parsed = parseSearchParams(searchParams);
  const limit = LIST_POSTS_DEFAULT_LIMIT;
  const offset = (parsed.page - 1) * limit;

  const result = await listPostsForSite(params.id, {
    status: parsed.status ?? undefined,
    query: parsed.query ?? undefined,
    limit,
    offset,
  });
  if (!result.ok) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
      >
        Failed to load posts: {result.error.message}
      </div>
    );
  }

  const { items, total } = result.data;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.min(parsed.page, totalPages);
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + limit, total);

  return (
    <main className="mx-auto max-w-5xl p-6">
      <Breadcrumbs
        crumbs={[
          { label: "Sites", href: "/admin/sites" },
          { label: site.name, href: `/admin/sites/${site.id}` },
          { label: "Posts" },
        ]}
      />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Posts</h1>
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground">
            {total} total{total > 0 ? ` · showing ${rangeStart}–${rangeEnd}` : ""}
          </p>
          {/* BP-3 — entry-point for single-post creation. */}
          <Link
            href={`/admin/sites/${site.id}/posts/new`}
            className="inline-flex h-9 items-center rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted transition-smooth"
            data-testid="new-post-button"
          >
            New post
          </Link>
        </div>
      </div>

      <form
        method="get"
        action={`/admin/sites/${site.id}/posts`}
        className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border p-3"
        role="search"
        aria-label="Filter posts"
      >
        <div>
          <label
            htmlFor="status-filter"
            className="block text-xs font-medium text-muted-foreground"
          >
            Status
          </label>
          <select
            id="status-filter"
            name="status"
            defaultValue={parsed.status ?? ""}
            className="mt-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm"
          >
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="scheduled">Scheduled</option>
          </select>
        </div>
        <div className="flex-1">
          <label
            htmlFor="q-filter"
            className="block text-xs font-medium text-muted-foreground"
          >
            Search title / slug
          </label>
          <input
            id="q-filter"
            type="search"
            name="q"
            defaultValue={parsed.query ?? ""}
            placeholder="e.g. welcome, best-practices"
            className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm"
          />
        </div>
        <button
          type="submit"
          className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
        >
          Apply
        </button>
        {(parsed.status || parsed.query) && (
          <Link
            href={`/admin/sites/${site.id}/posts`}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            Clear filters
          </Link>
        )}
      </form>

      {items.length === 0 ? (
        <div
          role="status"
          className="mt-6 rounded-md border border-muted-foreground/20 bg-muted/20 p-6 text-center text-sm text-muted-foreground"
        >
          No posts match the current filters. Posts are created by the brief
          runner when a post-mode brief commits + an operator approves its
          pages.
        </div>
      ) : (
        <ol className="mt-6 space-y-3">
          {items.map((post) => {
            const pill = statusPill(post.status);
            return (
              <li
                key={post.id}
                className="rounded-lg border p-4"
                aria-labelledby={`post-${post.id}-title`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex-1">
                    <h2
                      id={`post-${post.id}-title`}
                      className="text-base font-medium"
                    >
                      <Link
                        href={`/admin/sites/${site.id}/posts/${post.id}`}
                        className="hover:underline"
                      >
                        {post.title}
                      </Link>
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <code className="text-[11px]">/{post.slug}</code>
                      {post.wp_post_id
                        ? ` · WP id ${post.wp_post_id}`
                        : ""}
                    </p>
                  </div>
                  <span
                    className={`inline-flex shrink-0 rounded px-2 py-0.5 text-xs font-medium ${pill.cls}`}
                  >
                    {pill.label}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {totalPages > 1 && (
        <nav
          aria-label="Post list pagination"
          className="mt-6 flex items-center justify-between text-sm"
        >
          {currentPage > 1 ? (
            <Link
              href={buildHref(site.id, parsed, { page: currentPage - 1 })}
              className="underline hover:no-underline"
            >
              ← Previous
            </Link>
          ) : (
            <span className="text-muted-foreground">← Previous</span>
          )}
          <span className="text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
          {currentPage < totalPages ? (
            <Link
              href={buildHref(site.id, parsed, { page: currentPage + 1 })}
              className="underline hover:no-underline"
            >
              Next →
            </Link>
          ) : (
            <span className="text-muted-foreground">Next →</span>
          )}
        </nav>
      )}
    </main>
  );
}
