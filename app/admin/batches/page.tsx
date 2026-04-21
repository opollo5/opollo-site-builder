import Link from "next/link";
import { redirect } from "next/navigation";

import { NewBatchButton } from "@/components/NewBatchButton";
import type { BatchTemplateOption } from "@/components/NewBatchModal";
import { checkAdminAccess } from "@/lib/admin-gate";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// /admin/batches — M3-8.
//
// Admin + operator visible. Shows every generation_jobs row the caller
// is entitled to see (admins see all; operators see jobs they
// created — matches the RLS policy from M3-1). Server-rendered per
// request; no auto-refresh here — the detail page owns live updates.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

type BatchRow = {
  id: string;
  site_name: string;
  template_name: string;
  status: string;
  requested_count: number;
  succeeded_count: number;
  failed_count: number;
  created_at: string;
  created_by_email: string | null;
  total_cost_usd_cents: number;
};

function StatusBadge({ status }: { status: string }) {
  const palette: Record<string, string> = {
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

function formatDate(iso: string): string {
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

export default async function AdminBatchesPage({
  searchParams,
}: {
  searchParams: { site_id?: string };
}) {
  const access = await checkAdminAccess({
    requiredRoles: ["admin", "operator"],
    insufficientRoleRedirectTo: "/admin/sites",
  });
  if (access.kind === "redirect") redirect(access.to);

  const svc = getServiceRoleClient();
  const siteFilter =
    typeof searchParams.site_id === "string" &&
    /^[0-9a-f-]{36}$/i.test(searchParams.site_id)
      ? searchParams.site_id
      : null;

  // Join jobs with their site + template names + creator email. The
  // RLS policy scopes the rows for operators via EXISTS on
  // created_by; admins see everything.
  const callerFilter =
    access.user && access.user.role !== "admin" ? access.user.id : null;

  let query = svc
    .from("generation_jobs")
    .select(
      "id, status, requested_count, succeeded_count, failed_count, created_at, total_cost_usd_cents, created_by, site:sites!inner(name), template:design_templates!inner(name)",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (callerFilter) {
    query = query.eq("created_by", callerFilter);
  }
  if (siteFilter) {
    query = query.eq("site_id", siteFilter);
  }
  const { data: jobs, error } = await query;

  if (error) {
    return (
      <div
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        role="alert"
      >
        Failed to load batches: {error.message}
      </div>
    );
  }

  // Second pass for creator emails — cheap lookup.
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
    const site = j.site as unknown as { name: string } | null;
    const tmpl = j.template as unknown as { name: string } | null;
    return {
      id: j.id as string,
      site_name: site?.name ?? "—",
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

  // Resolve "Run batch" context: only when a site_id filter is
  // active do we have a target to point the modal at. On the
  // unfiltered view the button is disabled with a tooltip; the
  // per-site detail page is the primary entry-point for running
  // batches.
  let siteForButton: { id: string; name: string } | null = null;
  let templateOptions: BatchTemplateOption[] = [];
  if (siteFilter) {
    const siteRes = await svc
      .from("sites")
      .select("id, name")
      .eq("id", siteFilter)
      .neq("status", "removed")
      .maybeSingle();
    if (siteRes.data) {
      siteForButton = {
        id: siteRes.data.id as string,
        name: siteRes.data.name as string,
      };
      const { data: dsRow } = await svc
        .from("design_systems")
        .select("id")
        .eq("site_id", siteForButton.id)
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
    }
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Batches</h1>
          <p className="text-sm text-muted-foreground">
            {siteForButton
              ? `Batches for ${siteForButton.name}.`
              : "Every batch-generation run. Click a row for slot-level detail and cancellation."}
          </p>
          {siteForButton && (
            <Link
              href="/admin/batches"
              className="mt-1 inline-block text-xs text-muted-foreground hover:text-foreground"
            >
              ← All batches
            </Link>
          )}
        </div>
        <NewBatchButton
          site={siteForButton}
          templates={templateOptions}
          label="New batch"
        />
      </div>

      <div className="mt-6">
        {rows.length === 0 ? (
          <div className="rounded-md border p-8 text-center">
            <p className="text-sm text-muted-foreground">No batches yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Site / Template</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Progress</th>
                  <th className="px-3 py-2 font-medium">Cost</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2 font-medium">By</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-b-0">
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/batches/${r.id}`}
                        className="font-medium hover:underline"
                      >
                        {r.site_name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {r.template_name}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {r.succeeded_count} ok · {r.failed_count} fail ·{" "}
                      {r.requested_count} total
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {formatCostCents(r.total_cost_usd_cents)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {formatDate(r.created_at)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {r.created_by_email ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
