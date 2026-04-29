import Link from "next/link";

import { Button } from "@/components/ui/button";
import { listClients } from "@/lib/optimiser/clients";
import { listPendingProposals } from "@/lib/optimiser/proposals";

export const metadata = { title: "Optimiser · Proposals" };
export const dynamic = "force-dynamic";

const RISK_PILL: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-900 border-emerald-200",
  medium: "bg-amber-100 text-amber-900 border-amber-200",
  high: "bg-red-100 text-red-900 border-red-200",
};

export default async function OptimiserProposalsList({
  searchParams,
}: {
  searchParams?: { client?: string };
}) {
  const clients = await listClients();
  const onboarded = clients.filter((c) => c.onboarded_at);
  const selectedId = searchParams?.client ?? onboarded[0]?.id;
  const proposals = await listPendingProposals({
    clientId: selectedId,
    limit: 100,
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Proposals</h1>
          <p className="text-sm text-muted-foreground">
            Pending optimisation proposals, sorted by priority.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onboarded.length > 1 && (
            <form method="get" action="/optimiser/proposals" className="flex items-center gap-1">
              <select
                name="client"
                defaultValue={selectedId}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              >
                {onboarded.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="outline" type="submit">
                Switch
              </Button>
            </form>
          )}
          <Button asChild variant="outline">
            <Link href="/optimiser">Page browser</Link>
          </Button>
        </div>
      </header>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2">Headline</th>
              <th className="px-3 py-2">Risk</th>
              <th className="px-3 py-2 text-right">Priority</th>
              <th className="px-3 py-2 text-right">Confidence</th>
              <th className="px-3 py-2 text-right">Effort</th>
              <th className="px-3 py-2">Expected uplift</th>
              <th className="px-3 py-2">Expires</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {proposals.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                  No pending proposals.
                </td>
              </tr>
            )}
            {proposals.map((p) => (
              <tr key={p.id} className="border-t border-border align-top">
                <td className="px-3 py-2">
                  <div className="font-medium">{p.headline}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.problem_summary ?? "—"}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${RISK_PILL[p.risk_level]}`}
                  >
                    {p.risk_level}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {p.priority_score.toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {(p.confidence_score * 100).toFixed(0)}%
                </td>
                <td className="px-3 py-2 text-right">{p.effort_bucket}</td>
                <td className="px-3 py-2">
                  {p.expected_impact_min_pp != null && p.expected_impact_max_pp != null
                    ? `+${p.expected_impact_min_pp.toFixed(1)}–${p.expected_impact_max_pp.toFixed(1)}pp`
                    : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {p.expires_at ? new Date(p.expires_at).toLocaleDateString() : "—"}
                </td>
                <td className="px-3 py-2">
                  <Button asChild size="sm">
                    <Link href={`/optimiser/proposals/${p.id}`}>Review</Link>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
