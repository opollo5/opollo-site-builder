import Link from "next/link";
import { redirect } from "next/navigation";

import { BatchDetailClient } from "@/components/BatchDetailClient";
import { BatchSuccessMoment } from "@/components/BatchSuccessMoment";
import { Alert } from "@/components/ui/alert";
import {
  StatusPill,
  jobStatusKind,
  slotStateKind,
} from "@/components/ui/status-pill";
import { TDetailSummary } from "@/templates";
import { checkAdminAccess } from "@/lib/admin-gate";
import { getServiceRoleClient } from "@/lib/supabase";

// /admin/batches/[siteId]/[batchId] — batch detail page.

export const dynamic = "force-dynamic";

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

export default async function BatchDetailPage({
  params,
}: {
  params: { siteId: string; batchId: string };
}) {
  const access = await checkAdminAccess({
    requiredRoles: ["super_admin", "admin"],
    insufficientRoleRedirectTo: "/admin/sites",
  });
  if (access.kind === "redirect") redirect(access.to);

  const svc = getServiceRoleClient();
  const { data: job, error: jobErr } = await svc
    .from("generation_jobs")
    .select(
      "id, status, requested_count, succeeded_count, failed_count, created_at, finished_at, cancel_requested_at, total_cost_usd_cents, total_input_tokens, total_output_tokens, created_by, site:sites!inner(name, prefix), template:design_templates!inner(name, page_type)",
    )
    .eq("id", params.batchId)
    .maybeSingle();

  const batchesHref = `/admin/batches/${params.siteId}`;

  if (jobErr) {
    return (
      <TDetailSummary
        title="Failed to load batch"
        breadcrumb={[
          { label: "Admin", href: "/admin/sites" },
          { label: "Batches", href: batchesHref },
          { label: "Error" },
        ]}
        sections={[{ content: <Alert variant="destructive">{jobErr.message}</Alert> }]}
      />
    );
  }
  if (!job) {
    return (
      <div className="rounded-md border p-8 text-center">
        <p className="text-sm text-muted-foreground">Batch not found.</p>
        <Link href={batchesHref} className="mt-2 inline-block text-sm underline">
          ← Back to batches
        </Link>
      </div>
    );
  }

  if (
    access.user &&
    access.user.role !== "admin" &&
    job.created_by !== access.user.id
  ) {
    return (
      <div className="rounded-md border p-8 text-center">
        <p className="text-base text-muted-foreground">
          This batch belongs to another operator.
        </p>
      </div>
    );
  }

  const { data: slots } = await svc
    .from("generation_job_pages")
    .select(
      "id, slot_index, state, inputs, attempts, last_error_code, last_error_message, cost_usd_cents, wp_page_id, finished_at",
    )
    .eq("job_id", params.batchId)
    .order("slot_index", { ascending: true });

  const { data: recentEvents } = await svc
    .from("generation_events")
    .select("id, event, details, created_at")
    .eq("job_id", params.batchId)
    .order("id", { ascending: false })
    .limit(20);

  const site = job.site as unknown as { name: string; prefix: string };
  const tmpl = job.template as unknown as { name: string; page_type: string };

  return (
    <TDetailSummary
      title={`${site.name} · ${tmpl.name}`}
      breadcrumb={[
        { label: "Admin", href: "/admin/sites" },
        { label: "Batches", href: batchesHref },
        { label: `${site.name} · ${tmpl.name}` },
      ]}
      meta={
        <>
          <StatusPill kind={jobStatusKind(job.status as Parameters<typeof jobStatusKind>[0])} />
          <span>
            {job.succeeded_count} ok · {job.failed_count} fail ·{" "}
            {job.requested_count} total
          </span>
          <span>{formatCostCents(Number(job.total_cost_usd_cents ?? 0))}</span>
          <span>
            {Number(job.total_input_tokens ?? 0).toLocaleString()} in ·{" "}
            {Number(job.total_output_tokens ?? 0).toLocaleString()} out tokens
          </span>
          <span>created {formatDate(job.created_at as string)}</span>
          {job.finished_at && (
            <span>finished {formatDate(job.finished_at as string)}</span>
          )}
        </>
      }
      actions={<BatchDetailClient jobId={params.batchId} status={job.status as string} />}
      inlineAlert={
        job.status === "succeeded" ? (
          <BatchSuccessMoment
            jobId={params.batchId}
            succeededCount={Number(job.succeeded_count ?? 0)}
            siteName={site.name}
            siteId={params.siteId}
          />
        ) : undefined
      }
      sections={[{
        title: "Slots",
        content: (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Slug</th>
                  <th className="px-3 py-2 font-medium">State</th>
                  <th className="px-3 py-2 font-medium">Attempts</th>
                  <th className="px-3 py-2 font-medium">WP id</th>
                  <th className="px-3 py-2 font-medium">Cost</th>
                  <th className="px-3 py-2 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {(slots ?? []).map((s) => {
                  const inputs = s.inputs as Record<string, unknown>;
                  const slug =
                    typeof inputs?.slug === "string" ? (inputs.slug as string) : "—";
                  return (
                    <tr key={s.id as string} className="border-b last:border-b-0 align-top">
                      <td className="px-3 py-2 text-muted-foreground">{s.slot_index as number}</td>
                      <td className="px-3 py-2 font-mono">{slug}</td>
                      <td className="px-3 py-2">
                        <StatusPill kind={slotStateKind(s.state as Parameters<typeof slotStateKind>[0])} />
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{s.attempts as number}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {s.wp_page_id ? String(s.wp_page_id) : "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatCostCents(Number(s.cost_usd_cents ?? 0))}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {s.last_error_code ? (
                          <div>
                            <div className="font-medium text-destructive">
                              {s.last_error_code as string}
                            </div>
                            <div className="text-sm">
                              {(s.last_error_message as string | null) ?? ""}
                            </div>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ),
      }]}
      sidebar={
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Recent events</h3>
          <div className="flex flex-col gap-2">
            {(recentEvents ?? []).map((e) => (
              <div key={String(e.id)} className="rounded-md border p-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{e.event as string}</span>
                  <span className="text-sm text-muted-foreground">
                    {formatDate(e.created_at as string)}
                  </span>
                </div>
                <pre className="mt-1 overflow-x-auto text-sm text-muted-foreground">
                  {JSON.stringify(e.details ?? {}, null, 2)}
                </pre>
              </div>
            ))}
            {(recentEvents ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No events yet.</p>
            )}
          </div>
        </div>
      }
    />
  );
}
