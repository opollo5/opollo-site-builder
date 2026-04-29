import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import { EditPageMetadataButton } from "@/components/EditPageMetadataButton";
import { H1 } from "@/components/ui/typography";
import { PageHtmlPreview } from "@/components/PageHtmlPreview";
import { RegenHistoryPanel } from "@/components/RegenHistoryPanel";
import { RegenerateButton } from "@/components/RegenerateButton";
import { checkAdminAccess } from "@/lib/admin-gate";
import { getPage } from "@/lib/pages";
import { listRegenJobsForPage } from "@/lib/regeneration-publisher";
import { formatRelativeTime } from "@/lib/utils";

// ---------------------------------------------------------------------------
// /admin/sites/[id]/pages/[pageId] — M6-2.
//
// Per-page detail view. Scoped by (site_id, page_id) so a cross-site
// URL manipulation returns 404. Shows:
//
//   - Metadata grid: title, slug, type, status, DS version, template
//     name, WP page id (as a link to the WP admin edit URL), updated-at.
//   - Tier-2 preview: sandboxed iframe rendering generated_html under
//     our design-system CSS only. No allow-scripts.
//   - Tier-3 link: "Open in WordPress admin" → `{wp_url}/wp-admin/post.php?post={wp_page_id}&action=edit`.
//   - Back-link honours `?from=` so returning to the list preserves
//     filter state.
//
// Read-only. Metadata editing lands in M6-3.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RawSearchParams = {
  [key: string]: string | string[] | undefined;
};

function resolveBackHref(
  siteId: string,
  raw: RawSearchParams,
): string {
  const from = typeof raw.from === "string" ? raw.from : null;
  const fallback = `/admin/sites/${siteId}/pages`;
  if (!from) return fallback;
  // Accept only relative paths under the same site's pages surface.
  if (!from.startsWith(`/admin/sites/${siteId}/pages`)) return fallback;
  return from;
}

function statusBadge(status: string) {
  const palette: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    published: "bg-emerald-500/10 text-emerald-700",
  };
  return (
    <span
      className={`inline-flex rounded px-2 py-0.5 text-xs font-medium capitalize ${
        palette[status] ?? "bg-muted"
      }`}
    >
      {status}
    </span>
  );
}

function wpAdminEditUrl(wpUrl: string, wpPageId: number): string {
  // WP's post.php?post=<id>&action=edit works regardless of whether
  // the post is actually a page or a post — the same route edits both.
  const base = wpUrl.replace(/\/$/, "");
  return `${base}/wp-admin/post.php?post=${wpPageId}&action=edit`;
}

function wpPublicUrl(wpUrl: string, slug: string): string {
  const base = wpUrl.replace(/\/$/, "");
  return `${base}/${slug}`;
}

export default async function PageDetail({
  params,
  searchParams,
}: {
  params: { id: string; pageId: string };
  searchParams: RawSearchParams;
}) {
  const access = await checkAdminAccess({
    requiredRoles: ["admin", "operator"],
    insufficientRoleRedirectTo: "/admin/sites",
  });
  if (access.kind === "redirect") redirect(access.to);

  if (!UUID_RE.test(params.id) || !UUID_RE.test(params.pageId)) {
    notFound();
  }

  const result = await getPage(params.id, params.pageId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
      >
        Failed to load page: {result.error.message}
      </div>
    );
  }

  const page = result.data;
  const backHref = resolveBackHref(params.id, searchParams);

  // Regen history + in-flight detection. Service-role query behind the
  // admin gate; RLS isn't a factor here. Top row is the most recent;
  // `in-flight` is whichever row is pending or running (at most one
  // per page per the partial UNIQUE in migration 0011).
  const regenJobs = await listRegenJobsForPage(page.id, { limit: 10 });
  const inFlightJob = regenJobs.find(
    (j) => j.status === "pending" || j.status === "running",
  );

  return (
    <>
      <Breadcrumbs
        crumbs={[
          { label: "Sites", href: "/admin/sites" },
          { label: page.site_name, href: `/admin/sites/${params.id}` },
          { label: "Pages", href: backHref },
          { label: page.title.slice(0, 60) },
        ]}
      />

      <div className="mt-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <H1 className="truncate">{page.title}</H1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {statusBadge(page.status)}
            <span className="rounded bg-muted px-2 py-0.5">
              {page.page_type.replace(/_/g, " ")}
            </span>
            <span>/{page.slug}</span>
            <span>· updated {formatRelativeTime(page.updated_at)}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <RegenerateButton
            siteId={params.id}
            pageId={page.id}
            inFlightJobStatus={
              inFlightJob
                ? (inFlightJob.status as "pending" | "running")
                : null
            }
          />
          <EditPageMetadataButton
            siteId={params.id}
            page={{
              id: page.id,
              title: page.title,
              slug: page.slug,
              version_lock: page.version_lock,
            }}
          />
          {page.site_wp_url && (
            <>
              <a
                href={wpAdminEditUrl(page.site_wp_url, page.wp_page_id)}
                target="_blank"
                rel="noreferrer"
                className="text-xs underline hover:text-foreground"
                data-testid="wp-admin-link"
              >
                Open in WP admin ↗
              </a>
              {page.status === "published" && (
                <a
                  href={wpPublicUrl(page.site_wp_url, page.slug)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs underline hover:text-foreground"
                  data-testid="wp-public-link"
                >
                  View live ↗
                </a>
              )}
            </>
          )}
          <Link
            href={backHref}
            className="text-xs text-muted-foreground hover:text-foreground"
            data-testid="page-back-to-list"
          >
            ← Back to pages
          </Link>
        </div>
      </div>

      <section className="mt-6 grid gap-6 md:grid-cols-[2fr_1fr]">
        <PageHtmlPreview html={page.generated_html} />

        <dl
          className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm"
          data-testid="page-detail-fields"
        >
          <dt className="text-muted-foreground">Title</dt>
          <dd>{page.title}</dd>
          <dt className="text-muted-foreground">Slug</dt>
          <dd className="font-mono text-xs">{page.slug}</dd>
          <dt className="text-muted-foreground">Type</dt>
          <dd className="capitalize">
            {page.page_type.replace(/_/g, " ")}
          </dd>
          <dt className="text-muted-foreground">Status</dt>
          <dd>{statusBadge(page.status)}</dd>
          <dt className="text-muted-foreground">Template</dt>
          <dd>
            {page.template_name ?? (
              <span className="text-muted-foreground">—</span>
            )}
          </dd>
          <dt className="text-muted-foreground">DS version</dt>
          <dd>v{page.design_system_version}</dd>
          <dt className="text-muted-foreground">WP page id</dt>
          <dd className="font-mono text-xs">#{page.wp_page_id}</dd>
          <dt className="text-muted-foreground">Created</dt>
          <dd className="text-xs">{formatRelativeTime(page.created_at)}</dd>
          <dt className="text-muted-foreground">Updated</dt>
          <dd className="text-xs">{formatRelativeTime(page.updated_at)}</dd>
        </dl>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold">
          Re-generation history{" "}
          <span className="text-xs text-muted-foreground">
            ({regenJobs.length})
          </span>
        </h2>
        <p className="text-xs text-muted-foreground">
          Each row is one operator-triggered re-run against the current design
          system. Cost + tokens come from Anthropic; failures carry their
          terminal code. In-flight jobs auto-refresh while the Re-generate
          button polls.
        </p>
        <div className="mt-3">
          <RegenHistoryPanel jobs={regenJobs} />
        </div>
      </section>
    </>
  );
}
