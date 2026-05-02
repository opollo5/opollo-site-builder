import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import { EditTenantBudgetButton } from "@/components/EditTenantBudgetButton";
import { OnboardingReminderBanner } from "@/components/OnboardingReminderBanner";
import { SetupReminderBanner } from "@/components/SetupReminderBanner";
import { SiteDetailActions } from "@/components/SiteDetailActions";
import { TenantBudgetBadge } from "@/components/TenantBudgetBadge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  StatusPill,
  briefStatusKind,
  dsStatusKind,
  jobStatusKind,
  siteStatusKind,
} from "@/components/ui/status-pill";
import { H1, H3 } from "@/components/ui/typography";
import { FileText, Layers, Sparkles, Workflow } from "lucide-react";
import { UploadBriefButton } from "@/components/UploadBriefButton";
import { checkAdminAccess } from "@/lib/admin-gate";
import { listSiteBriefs } from "@/lib/briefs";
import { getSetupStatus } from "@/lib/site-setup";
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

// StatusBadge folded to A-4's StatusPill primitive. Per-call-site
// mappers below pick the right domain (site / job / brief / ds).

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
    requiredRoles: ["super_admin", "admin"],
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

  // DESIGN-DISCOVERY PR 12 — banner reminding the operator to run
  // the setup wizard. Renders only when BOTH discovery statuses are
  // 'pending'; the banner itself manages dismissal via localStorage.
  const setupStatusResult = await getSetupStatus(site.id);

  // DESIGN-SYSTEM-OVERHAUL PR 6 — site_mode gate. NULL = operator
  // hasn't picked between copy_existing / new_design yet. Render the
  // onboarding banner and suppress the design-discovery one (which
  // only applies to the new_design path).
  const { data: siteModeRow } = await svc
    .from("sites")
    .select("site_mode")
    .eq("id", site.id)
    .maybeSingle();
  const siteMode = (siteModeRow?.site_mode as string | null) ?? null;
  const needsOnboarding = siteMode === null;
  const needsSetupReminder =
    !needsOnboarding &&
    siteMode === "new_design" &&
    setupStatusResult.ok &&
    setupStatusResult.data.design_direction_status === "pending" &&
    setupStatusResult.data.tone_of_voice_status === "pending";

  return (
    <>
      {needsOnboarding && <OnboardingReminderBanner siteId={site.id} />}
      {needsSetupReminder && <SetupReminderBanner siteId={site.id} />}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Breadcrumbs
            crumbs={[
              { label: "Admin", href: "/admin/sites" },
              { label: "Sites", href: "/admin/sites" },
              { label: site.name },
            ]}
          />
          <H1 className="mt-2">{site.name}</H1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
            <StatusPill kind={siteStatusKind(site.status as Parameters<typeof siteStatusKind>[0])} />
            <a
              href={site.wp_url}
              target="_blank"
              rel="noreferrer"
              className="transition-smooth hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
            >
              {site.wp_url}
            </a>
            <Link
              href={`/admin/sites/${site.id}/pages`}
              className="transition-smooth hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
              data-testid="site-pages-link"
            >
              Pages →
            </Link>
            <span data-screenshot-mask>updated {formatDate(site.updated_at)}</span>
          </div>
        </div>
        <SiteDetailActions
          site={{ id: site.id, name: site.name, wp_url: site.wp_url }}
          templates={batchTemplateOptions}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
         <section>
          <div className="flex items-center justify-between">
            <H3>Recent batches</H3>
            <Link
              href={`/admin/batches?site_id=${encodeURIComponent(site.id)}`}
              className="text-xs text-muted-foreground transition-smooth hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
            >
              View all →
            </Link>
          </div>
          <div className="mt-2 overflow-x-auto rounded-md border">
            {(batches ?? []).length === 0 ? (
              <div className="p-3">
                <EmptyState
                  density="compact"
                  icon={Workflow}
                  iconLabel="No batches"
                  title="No batches yet"
                  body={
                    <>
                      Run a batch to generate multiple pages from a template
                      against the active design system.
                    </>
                  }
                />
              </div>
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
                          <StatusPill kind={jobStatusKind(b.status as Parameters<typeof jobStatusKind>[0])} />
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
            <H3>Briefs</H3>
            <UploadBriefButton siteId={site.id} />
          </div>
          <div className="mt-2 overflow-x-auto rounded-md border">
            {briefs.length === 0 ? (
              <div className="p-3">
                <EmptyState
                  density="compact"
                  icon={FileText}
                  iconLabel="No briefs"
                  title="No briefs yet"
                  body={
                    <>
                      Upload a single markdown / text document and Opollo
                      parses it into a list of pages, then generates each one.
                    </>
                  }
                />
              </div>
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
                        <StatusPill kind={briefStatusKind(b.status as Parameters<typeof briefStatusKind>[0])} />
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

        <aside className="space-y-4">
          <div className="rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <H3>Budget</H3>
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

          <div className="rounded-lg border p-3">
            <H3>Design system</H3>
            <div className="mt-2 text-xs">
              {ds ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Version {String(ds.version)}</span>
                    <StatusPill kind={dsStatusKind(ds.status as Parameters<typeof dsStatusKind>[0])} />
                  </div>
                  <p className="mt-1 text-muted-foreground" data-screenshot-mask>
                    Activated {formatDate(ds.activated_at as string | null)}
                  </p>
                  <div className="mt-2 flex flex-col gap-0.5">
                    <Link
                      href={`/admin/sites/${site.id}/design-system`}
                      className="text-muted-foreground transition-smooth hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                    >
                      Overview →
                    </Link>
                    <Link
                      href={`/admin/sites/${site.id}/design-system/components`}
                      className="text-muted-foreground transition-smooth hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                    >
                      Components{templates.length === 0 ? " (none)" : ""} →
                    </Link>
                    <Link
                      href={`/admin/sites/${site.id}/design-system/templates`}
                      className="text-muted-foreground transition-smooth hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                    >
                      Templates ({templates.length}) →
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-muted-foreground">
                    {needsOnboarding
                      ? "Pick how you want to use this site to get going."
                      : "No active design system. Create one before running batches."}
                  </p>
                  <Link
                    href={
                      needsOnboarding
                        ? `/admin/sites/${site.id}/onboarding`
                        : `/admin/sites/${site.id}/design-system`
                    }
                    className="mt-2 inline-block text-muted-foreground transition-smooth hover:text-foreground"
                  >
                    {needsOnboarding ? "Set up now →" : "Set up design system →"}
                  </Link>
                </>
              )}
            </div>
          </div>

          {/* M13-5d — Appearance panel link. */}
          <div className="rounded-lg border p-3">
            <div className="flex items-start gap-2">
              <Layers aria-hidden className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <H3>Appearance</H3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Sync the active DS palette to Kadence on this site&apos;s
                  WordPress install.
                </p>
                <Link
                  href={`/admin/sites/${site.id}/appearance`}
                  className="mt-2 inline-block text-xs text-muted-foreground transition-smooth hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                >
                  Open Appearance panel →
                </Link>
              </div>
            </div>
          </div>

          {/* RS-2 — Settings (brand voice + design direction defaults). */}
          <div className="rounded-lg border p-3">
            <div className="flex items-start gap-2">
              <Sparkles aria-hidden className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <H3>Settings</H3>
                  {(site.brand_voice || site.design_direction) ? (
                    <StatusPill kind="brief_committed" label="Configured" />
                  ) : (
                    <StatusPill kind="brief_parsing" label="Not set" />
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Brand voice &amp; design direction defaults that every new
                  brief inherits.
                </p>
                <Link
                  href={`/admin/sites/${site.id}/settings`}
                  className="mt-2 inline-block text-xs text-muted-foreground transition-smooth hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                >
                  Open Settings →
                </Link>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
