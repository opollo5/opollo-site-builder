import { redirect } from "next/navigation";

import { BatchesTable, type BatchRow } from "@/components/BatchesTable";
import { NewBatchButton } from "@/components/NewBatchButton";
import type { BatchTemplateOption } from "@/components/NewBatchModal";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { checkAdminAccess } from "@/lib/admin-gate";
import { getServiceRoleClient } from "@/lib/supabase";

// /admin/batches/[siteId] — site-scoped batch list.
//
// Replaces the ?site_id= query-param pattern. Site selector is in the
// section rail; this page only handles the filtered list for a known site.

export const dynamic = "force-dynamic";

export default async function AdminBatchesSitePage({
  params,
}: {
  params: { siteId: string };
}) {
  const access = await checkAdminAccess({
    requiredRoles: ["super_admin", "admin"],
    insufficientRoleRedirectTo: "/admin/sites",
  });
  if (access.kind === "redirect") redirect(access.to);

  // Validate the siteId looks like a UUID; redirect to entry if not.
  if (!/^[0-9a-f-]{36}$/i.test(params.siteId)) {
    redirect("/admin/batches");
  }

  const svc = getServiceRoleClient();
  const callerFilter =
    access.user && access.user.role !== "admin" ? access.user.id : null;

  let query = svc
    .from("generation_jobs")
    .select(
      "id, status, requested_count, succeeded_count, failed_count, created_at, total_cost_usd_cents, created_by, site:sites!inner(id, name), template:design_templates!inner(name)",
    )
    .eq("site_id", params.siteId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (callerFilter) {
    query = query.eq("created_by", callerFilter);
  }
  const { data: jobs, error } = await query;

  // Resolve site name + template options.
  const siteRes = await svc
    .from("sites")
    .select("id, name")
    .eq("id", params.siteId)
    .neq("status", "removed")
    .maybeSingle();

  if (!siteRes.data) {
    redirect("/admin/batches");
  }

  const site = { id: siteRes.data.id as string, name: siteRes.data.name as string };

  if (error) {
    return (
      <>
        <PageHeader>
          <PageHeader.Breadcrumb
            segments={[
              { label: "Admin", href: "/admin/sites" },
              { label: "Batches", href: "/admin/batches" },
              { label: site.name },
            ]}
          />
          <PageHeader.Title>Batches — {site.name}</PageHeader.Title>
        </PageHeader>
        <Alert variant="destructive" title="Failed to load batches">
          {error.message}
        </Alert>
      </>
    );
  }

  // Creator email lookup.
  const creatorIds = Array.from(
    new Set((jobs ?? []).map((r) => r.created_by).filter(Boolean)),
  ) as string[];
  const emailMap = new Map<string, string>();
  if (creatorIds.length > 0) {
    const { data: users } = await svc
      .from("opollo_users")
      .select("id, email")
      .in("id", creatorIds);
    for (const u of users ?? []) {
      emailMap.set(u.id as string, u.email as string);
    }
  }

  const rows: BatchRow[] = (jobs ?? []).map((j) => {
    const tmpl = j.template as unknown as { name: string } | null;
    return {
      id: j.id as string,
      site_id: params.siteId,
      site_name: site.name,
      template_name: tmpl?.name ?? "—",
      status: j.status as string,
      requested_count: j.requested_count as number,
      succeeded_count: j.succeeded_count as number,
      failed_count: j.failed_count as number,
      created_at: j.created_at as string,
      created_by_email:
        typeof j.created_by === "string"
          ? emailMap.get(j.created_by) ?? null
          : null,
      total_cost_usd_cents: Number(j.total_cost_usd_cents ?? 0),
    };
  });

  // Template options for the "New batch" modal.
  let templateOptions: BatchTemplateOption[] = [];
  const { data: dsRow } = await svc
    .from("design_systems")
    .select("id")
    .eq("site_id", site.id)
    .eq("status", "active")
    .maybeSingle();
  if (dsRow) {
    const { data: tmpls } = await svc
      .from("design_templates")
      .select("id, name, page_type")
      .eq("design_system_id", dsRow.id as string)
      .order("page_type", { ascending: true });
    templateOptions = (tmpls ?? []).map((t) => ({
      id: t.id as string,
      name: t.name as string,
      page_type: t.page_type as string,
    }));
  }

  const subtitle = `${rows.length} ${rows.length === 1 ? "batch" : "batches"} for ${site.name}.`;

  return (
    <>
      <PageHeader>
        <PageHeader.Breadcrumb
          segments={[
            { label: "Admin", href: "/admin/sites" },
            { label: "Batches", href: "/admin/batches" },
            { label: site.name },
          ]}
        />
        <PageHeader.Title>Batches — {site.name}</PageHeader.Title>
        <PageHeader.Subtitle>{subtitle}</PageHeader.Subtitle>
        <PageHeader.Actions>
          <NewBatchButton site={site} templates={templateOptions} label="New batch" />
        </PageHeader.Actions>
      </PageHeader>

      <div>
        <BatchesTable rows={rows} siteId={params.siteId} />
      </div>
    </>
  );
}
