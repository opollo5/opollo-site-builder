import { redirect } from "next/navigation";
import Link from "next/link";

import { canDo, getCurrentPlatformSession } from "@/lib/platform/auth";
import { getServiceRoleClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const STATE_LABELS: Record<string, { label: string; colour: string }> = {
  pending:   { label: "Pending",   colour: "bg-muted text-muted-foreground" },
  running:   { label: "Running",   colour: "bg-blue-100 text-blue-700" },
  completed: { label: "Done",      colour: "bg-green-100 text-green-700" },
  partial:   { label: "Partial",   colour: "bg-amber-100 text-amber-700" },
  failed:    { label: "Failed",    colour: "bg-red-100 text-red-700" },
};

export default async function BatchHistoryPage() {
  const session = await getCurrentPlatformSession();
  if (!session) redirect("/login?next=/company/image/batches");
  if (!session.company) redirect("/company");

  const companyId = session.company.companyId;
  if (!await canDo(companyId, "create_post")) redirect("/company");

  const svc = getServiceRoleClient();
  const { data: batches } = await svc
    .from("image_generation_batches")
    .select("id, state, total_jobs, completed_jobs, failed_jobs, source_filename, source_row_count, created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Batch history</h1>
        <p className="text-sm text-muted-foreground mt-1">Past image generation batches.</p>
      </div>

      {!batches?.length ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No batches yet. Upload a document from{" "}
          <Link href="/company/image/ingest" className="underline">Image ingest</Link>.
        </p>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
          {batches.map((b) => {
            const st = STATE_LABELS[b.state] ?? { label: b.state, colour: "bg-muted text-muted-foreground" };
            const date = new Date(b.created_at as string).toLocaleDateString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
            return (
              <Link key={b.id} href={`/company/image/batches/${b.id}`} className="flex items-center justify-between px-5 py-4 bg-card hover:bg-accent transition-colors gap-4">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">
                    {b.source_filename ?? `Batch ${(b.id as string).slice(0, 8)}`}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {date} · {b.total_jobs} jobs
                    {b.source_row_count ? ` from ${b.source_row_count} rows` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <p className="text-xs text-muted-foreground">
                    {b.completed_jobs}/{b.total_jobs} done{b.failed_jobs > 0 ? ` · ${b.failed_jobs} failed` : ""}
                  </p>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.colour}`}>
                    {st.label}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
