import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { canDo, getCurrentPlatformSession } from "@/lib/platform/auth";
import { getProofDashboard } from "@/lib/platform/proofing/engine";
import type { DashboardItem } from "@/lib/platform/proofing/engine";

// ---------------------------------------------------------------------------
// /company/[id]/proofing — Proof dashboard (Pending + Stuck)
//
// Two views only per B3 scope decision:
//   Pending: open proofs on which step and on whom
//   Stuck: proofs that have gone past their expiry window / gone cold
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export default async function ProofingDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: companyId } = await params;
  const session = await getCurrentPlatformSession();
  if (!session) redirect(`/login?next=/company/${companyId}/proofing`);
  if (!await canDo(companyId, "approve_post")) redirect(`/company/${companyId}`);

  const { pending, stuck } = await getProofDashboard(companyId);

  return (
    <main className="p-6 space-y-8">
      <PageHeader>
        <PageHeader.Title>Proofing dashboard</PageHeader.Title>
        <PageHeader.Subtitle>
          {pending.length} pending · {stuck.length} stuck
        </PageHeader.Subtitle>
      </PageHeader>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Pending
        </h2>
        {pending.length === 0 ? (
          <EmptyState message="No proofs waiting for review." />
        ) : (
          <ProofList items={pending} companyId={companyId} />
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Stuck
        </h2>
        {stuck.length === 0 ? (
          <EmptyState message="No stuck proofs." />
        ) : (
          <ProofList items={stuck} companyId={companyId} isStuck />
        )}
      </section>
    </main>
  );
}

function ProofList({
  items,
  companyId,
  isStuck = false,
}: {
  items: DashboardItem[];
  companyId: string;
  isStuck?: boolean;
}) {
  return (
    <ul className="divide-y rounded-lg border bg-card">
      {items.map((item) => (
        <li key={item.approvalRequestId} className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              {/* Content summary */}
              <p className="font-semibold text-foreground truncate">
                {item.snapshot?.content
                  ? item.snapshot.content.slice(0, 80) + (item.snapshot.content.length > 80 ? "…" : "")
                  : `Version ${item.snapshot?.version_number ?? "?"}`}
              </p>

              {/* Step info */}
              <p className="mt-1 text-sm text-muted-foreground">
                {item.stepName
                  ? <>Step {item.stepOrder}: <strong>{item.stepName}</strong></>
                  : "No step assigned"}
                {item.pendingRecipients.length > 0 && (
                  <> · waiting on {item.pendingRecipients.map((r) => r.email).join(", ")}</>
                )}
              </p>

              {/* Dates */}
              <p className="mt-0.5 text-xs text-muted-foreground">
                Opened {new Date(item.openedAt).toLocaleDateString("en-AU", {
                  day: "numeric", month: "short", year: "numeric",
                })}
                {isStuck && (
                  <span className="ml-2 text-destructive">· expired {new Date(item.expiresAt).toLocaleDateString("en-AU", {
                    day: "numeric", month: "short",
                  })}</span>
                )}
              </p>
            </div>

            {/* Actions */}
            <div className="shrink-0 flex flex-col gap-2 items-end">
              <a
                href={`/company/${companyId}/proofing/${item.contentGroupId}/versions`}
                className="text-sm text-primary hover:underline"
              >
                View versions
              </a>
              <a
                href={`/api/platform/proofing/${item.contentGroupId}/audit?company_id=${companyId}&format=csv`}
                className="text-xs text-muted-foreground hover:underline"
                download
              >
                Export audit
              </a>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border bg-card p-8 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
