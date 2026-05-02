import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import { checkAdminAccess } from "@/lib/admin-gate";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill, postStatusKind } from "@/components/ui/status-pill";
import { H1, Lead } from "@/components/ui/typography";
import { FileText, Plus } from "lucide-react";
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

export default async function SitePostsList({
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

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <H1>Posts</H1>
          <Lead className="mt-0.5">
            {total === 0
              ? "No posts on this site yet."
              : `${total} ${total === 1 ? "post" : "posts"}${total > 0 && items.length < total ? ` · showing ${rangeStart}–${rangeEnd}` : ""}`}
          </Lead>
        </div>
        <Button asChild>
          <Link
            href={`/admin/sites/${site.id}/posts/new`}
            data-testid="new-post-button"
          >
            <Plus aria-hidden className="h-4 w-4" />
            New post
          </Link>
        </Button>
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
            className="block text-sm font-medium text-muted-foreground"
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
            className="block text-sm font-medium text-muted-foreground"
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
            className="text-sm text-muted-foreground underline hover:text-foreground"
          >
            Clear filters
          </Link>
        )}
      </form>

      {items.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={FileText}
            iconLabel="No posts"
            title={
              parsed.status || parsed.query
                ? "No posts match the current filters"
                : "No posts on this site yet"
            }
            body={
              parsed.status || parsed.query ? (
                <>
                  Adjust the filters above, or clear them to see every post.
                </>
              ) : (
                <>
                  Create your first single-post draft, or generate a batch
                  of posts via a post-mode brief.
                </>
              )
            }
            cta={
              !parsed.status && !parsed.query ? (
                <Button asChild>
                  <Link href={`/admin/sites/${site.id}/posts/new`}>
                    <Plus aria-hidden className="h-4 w-4" />
                    New post
                  </Link>
                </Button>
              ) : (
                <Button asChild variant="outline">
                  <Link href={`/admin/sites/${site.id}/posts`}>
                    Clear filters
                  </Link>
                </Button>
              )
            }
          />
        </div>
      ) : (
        <ol className="mt-4 space-y-2">
          {items.map((post) => {
            return (
              <li
                key={post.id}
                className="rounded-lg border p-3 transition-smooth hover:bg-muted/40"
                aria-labelledby={`post-${post.id}-title`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2
                      id={`post-${post.id}-title`}
                      className="text-sm font-semibold"
                    >
                      <Link
                        href={`/admin/sites/${site.id}/posts/${post.id}`}
                        className="transition-smooth hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                      >
                        {post.title}
                      </Link>
                    </h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      <code className="text-[11px]">/{post.slug}</code>
                      {post.wp_post_id
                        ? ` · WP id ${post.wp_post_id}`
                        : ""}
                    </p>
                  </div>
                  <StatusPill
                    kind={postStatusKind(post.status)}
                    className="shrink-0 capitalize"
                  />
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
