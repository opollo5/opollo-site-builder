import Link from "next/link";

import { Button } from "@/components/ui/button";
import { listClients } from "@/lib/optimiser/clients";
import { listChangeLog } from "@/lib/optimiser/change-log";

export const metadata = { title: "Optimiser · Change log" };
export const dynamic = "force-dynamic";

export default async function OptimiserChangeLogPage({
  searchParams,
}: {
  searchParams?: { client?: string };
}) {
  const clients = await listClients();
  const onboarded = clients.filter((c) => c.onboarded_at);
  const selectedId = searchParams?.client ?? onboarded[0]?.id;
  const rows = selectedId
    ? await listChangeLog({ clientId: selectedId, limit: 200 })
    : [];

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Change log</h1>
          <p className="text-sm text-muted-foreground">
            Append-only audit trail of every page change applied through the engine.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onboarded.length > 1 && (
            <form method="get" action="/optimiser/change-log" className="flex items-center gap-1">
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
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Event</th>
              <th className="px-3 py-2">Proposal</th>
              <th className="px-3 py-2">Page</th>
              <th className="px-3 py-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  No change-log entries yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(r.created_at).toLocaleString()}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{r.event}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {r.proposal_id ? (
                    <Link
                      href={`/optimiser/proposals/${r.proposal_id}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {r.proposal_id.slice(0, 8)}…
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {r.landing_page_id ? `${r.landing_page_id.slice(0, 8)}…` : "—"}
                </td>
                <td className="px-3 py-2">
                  <pre className="max-h-32 max-w-md overflow-auto rounded bg-muted p-2 text-xs">
{JSON.stringify(r.details, null, 2)}
                  </pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
