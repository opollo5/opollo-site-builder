import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { RegenJobRow } from "@/lib/regeneration-publisher";
import { formatRelativeTime } from "@/lib/utils";

// ---------------------------------------------------------------------------
// M7-4 — re-gen history panel.
//
// Shows the last N regen jobs for this page with their terminal (or
// in-flight) state. Pure presentation — the detail page fetches the
// rows via listRegenJobsForPage and passes them in.
// ---------------------------------------------------------------------------

function statusTone(status: string): NonNullable<BadgeProps["tone"]> {
  switch (status) {
    case "running":
      return "info";
    case "succeeded":
      return "success";
    case "failed":
    case "failed_gates":
      return "error";
    case "pending":
    case "cancelled":
    default:
      return "neutral";
  }
}

function formatCostCents(cents: number): string {
  if (cents === 0) return "—";
  return `$${(cents / 100).toFixed(3)}`;
}

export function RegenHistoryPanel({ jobs }: { jobs: RegenJobRow[] }) {
  if (jobs.length === 0) {
    return (
      <div
        className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground"
        data-testid="regen-history-empty"
      >
        No regenerations yet. Click &ldquo;Re-generate&rdquo; to refresh this
        page against the current design system.
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-md border"
      data-testid="regen-history-panel"
    >
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Attempts</th>
            <th className="px-4 py-2 font-medium">Cost</th>
            <th className="px-4 py-2 font-medium">Tokens (in / out)</th>
            <th className="px-4 py-2 font-medium">Started</th>
            <th className="px-4 py-2 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr
              key={job.id}
              className="border-b last:border-b-0"
              data-testid="regen-history-row"
              data-job-id={job.id}
              data-status={job.status}
            >
              <td className="px-4 py-3 align-top">
                <Badge tone={statusTone(job.status)} className="capitalize">
                  {job.status.replace(/_/g, " ")}
                </Badge>
              </td>
              <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                {job.attempts}
              </td>
              <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                {formatCostCents(job.cost_usd_cents)}
              </td>
              <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                {job.input_tokens} / {job.output_tokens}
              </td>
              <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                {job.started_at
                  ? formatRelativeTime(job.started_at)
                  : formatRelativeTime(job.created_at)}
              </td>
              <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                {job.failure_code ? (
                  <span
                    className="text-destructive"
                    title={job.failure_detail ?? undefined}
                  >
                    {job.failure_code}
                  </span>
                ) : job.cancel_requested_at ? (
                  "cancel requested"
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
