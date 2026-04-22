import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import { EditTenantBudgetButton } from "@/components/EditTenantBudgetButton";
import { NewBatchButton } from "@/components/NewBatchButton";
import { SiteActionsMenu } from "@/components/SiteActionsMenu";
import { TenantBudgetBadge } from "@/components/TenantBudgetBadge";
import { UploadBriefButton } from "@/components/UploadBriefButton";
import { checkAdminAccess } from "@/lib/admin-gate";
import { listSiteBriefs } from "@/lib/briefs";
import { getSite } from "@/lib/sites";
import { getServiceRoleClient } from "@/lib/supabase";
import { getTenantBudget } from "@/lib/tenant-budgets";
import type { BatchTemplateOption } from "@/components/NewBatchModal";

// /admin/sites/[id] — M2d UX cleanup.
//
// Per-site dashboard. Shows the site basics, the active design
// system link, a list of recent batches for this site, and a
// "Run batch" button that opens the same modal used on the batches
// index page. Archiving / editing happens through the three-dot
// menu inherited from the row (here rendered standalone).

export const dynamic = "force-dynamic";

type TemplateRow = {
  id: string;
  name: string;
  page_type: string;
  is_default: boolean;
};

function StatusBadge({ status }: { status: string }) {
  const palette: Record<string, string> = {
    active: "bg-emerald-500/10 text-emerald-700",
    pending_pairing: "bg-muted text-muted-foreground",
    paused: "bg-yellow-500/10 text-yellow-700",
    removed: "bg-destructive/10 text-destructive",
    queued: "bg-muted text-muted-foreground",
    running: "bg-primary/10 text-primary",
    partial: "bg-yellow-500/10 text-yellow-700",
    succeeded: "bg-emerald-500/10 text-emerald-700",
    failed: "bg-destructive/10 text-destructive",
    cancelled: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${
        palette[status] ?? "bg-muted"
      }`}
    >
      {status}
    </span>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatCostCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function SiteDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const access = await checkAdminAccess({
    requiredRoles: ["admin", "operator"],
    insufficientRoleRedirectTo: "/",
  });
  if (access.kind === "redirect") redirect(access.to);

  const result = await getSite(params.id);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <div
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        role="alert"
      >
        {result.error.message}
      </div>
    );
  }
  const site = result.data.site;

  const svc = getServiceRoleClient();

  // Active design system + its templates. Active DS is a singleton
  // per site (M1a partial unique index).
  const { data: ds } = await svc
    .from("design_systems")
    .select("id, version, status, activated_at")
    .eq("site_id", site.id)
    .eq("status", "active")
    .maybeSingle();

  let templates: TemplateRow[] = [];
  if (ds) {
    const { data } = await svc
      .from("design_templates")
      .select("id, name, page_type, is_default")
      .eq("design_system_id", ds.id as string)
      .order("page_type", { ascending: true })
      .order("name", { ascending: true });
    templates = (data ?? []) as TemplateRow[];
  }
  const batchTemplateOptions: BatchTemplateOption[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    page_type: t.page_type,
  }));

  // Recent batches for this site. RLS: service-role, so scoped by
  // site_id only at the app layer; caller role is already admin or
  // operator via checkAdminAccess.
  const { data: batches } = await svc
    .from("generation_jobs")
    .select(
      "id, status, requested_count, succeeded_count, failed_count, created_at, total_cost_usd_cents, template:design_templates!inner(name)",
    )
    .eq("site_id", site.id)
    .order("created_at", { ascending: false })
    .limit(20);

  // M8-5 — tenant budget badge. Admin-only; operators view the
  // site surface but only admins edit caps. The badge itself is
  // visible to operators for budget self-diagnosis.
  const tenantBudget = await getTenantBudget(site.id);
  const isAdmin = access.user?.role === "admin" || access.user === null;

  // M12-1 — briefs list. Empty for sites that haven't uploaded one yet.
  const briefsResult = await listSiteBriefs(site.id);
  const briefs = briefsResult.ok ? briefsResult.data.briefs : [];

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <Breadcrumbs
            crumbs={[
              { label: "Admin", href: "/admin/sites" },
              { label: "Sites", href: "/admin/sites" },
              { label: site.name },
            ]}
          />
          <h1 className="mt-1 text-xl font-semibold">{site.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <StatusBadge status={site.status} />
            <a
              href={site.wp_url}
              target="_blank"
              rel="noreferrer"
              className="hover:underline"
            >
              {site.wp_url}
            </a>
            <Link
              href={`/admin/sites/${site.id}/pages`}
              className="hover:text-foreground hover:underline"
              data-testid="site-pages-link"
            >
              Pages →
            </Link>
            <span>updated {formatDate(site.updated_at)}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <NewBatchButton
            site={{ id: site.id, name: site.name }}
            templates={batchTemplateOptions}
          />
          <SiteActionsMenu
            siteId={site.id}
            name={site.name}
            wpUrl={site.wp_url}
          />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-8">
         <section>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recent batches</h2>
            <Link
              href={`/admin/batches?site_id=${encodeURIComponent(site.id)}`}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              View all →
            </Link>
          </div>
          <div className="mt-2 overflow-x-auto rounded-md border">
            {(batches ?? []).length === 0 ? (
              <p className="p-6 text-center text-xs text-muted-foreground">
                No batches yet. Click &ldquo;Run batch&rdquo; to generate your first.
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Template</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Progress</th>
                    <th className="px-3 py-2 font-medium">Cost</th>
                    <th className="px-3 py-2 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {(batches ?? []).map((b) => {
                    const tmpl = b.template as unknown as {
                      name: string;
                    } | null;
                    return (
                      <tr
                        key={b.id as string}
                        className="border-b last:border-b-0"
                      >
                        <td className="px-3 py-2">
                          <Link
                            href={`/admin/batches/${b.id as string}`}
                            className="font-medium hover:underline"
                          >
                            {tmpl?.name ?? "—"}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={b.status as string} />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {b.succeeded_count as number} ok ·{" "}
                          {b.failed_count as number} fail ·{" "}
                          {b.requested_count as number} total
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {formatCostCents(
                            Number(b.total_cost_usd_cents ?? 0),
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {formatDate(b.created_at as string)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Briefs</h2>
            <UploadBriefButton siteId={site.id} />
          </div>
          <div className="mt-2 overflow-x-auto rounded-md border">
            {briefs.length === 0 ? (
              <p className="p-6 text-center text-xs text-muted-foreground">
                No briefs yet. Upload a document to generate a whole site from a single brief.
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Title</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Parser</th>
                    <th className="px-3 py-2 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {briefs.map((b) => (
                    <tr key={b.id} className="border-b last:border-b-0">
                      <td className="px-3 py-2">
                        <Link
                          href={`/admin/sites/${site.id}/briefs/${b.id}/review`}
                          className="font-medium hover:underline"
                          data-testid={`brief-row-${b.id}`}
                        >
                          {b.title}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={b.status} />
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {b.parser_mode ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatDate(b.updated_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
        </div>

        <aside className="space-y-6">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Budget</h2>
              {isAdmin && tenantBudget && (
                <EditTenantBudgetButton
                  budget={{
                    site_id: tenantBudget.site_id,
                    daily_cap_cents: tenantBudget.daily_cap_cents,
                    monthly_cap_cents: tenantBudget.monthly_cap_cents,
                    version_lock: tenantBudget.version_lock,
                  }}
                />
              )}
            </div>
            <div className="mt-2">
              <TenantBudgetBadge budget={tenantBudget} />
            </div>
          </div>

          <h2 className="text-sm font-semibold">Design system</h2>
          <div className="mt-2 rounded-md border p-3 text-xs">
            {ds ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="font-medium">Version {String(ds.version)}</span>
                  <StatusBadge status={ds.status as string} />
                </div>
                <p className="mt-1 text-muted-foreground">
                  Activated {formatDate(ds.activated_at as string | null)}
                </p>
                <div className="mt-2 flex flex-col gap-1">
                  <Link
                    href={`/admin/sites/${site.id}/design-system`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Overview →
                  </Link>
                  <Link
                    href={`/admin/sites/${site.id}/design-system/components`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Components ({templates.length > 0 ? "" : "none"}) →
                  </Link>
                  <Link
                    href={`/admin/sites/${site.id}/design-system/templates`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Templates ({templates.length}) →
                  </Link>
                </div>
              </>
            ) : (
              <>
                <p className="text-muted-foreground">
                  No active design system. Create one before running batches.
                </p>
                <Link
                  href={`/admin/sites/${site.id}/design-system`}
                  className="mt-2 inline-block text-muted-foreground hover:text-foreground"
                >
                  Set up design system →
                </Link>
              </>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
