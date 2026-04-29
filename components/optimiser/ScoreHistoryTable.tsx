import {
  classificationBadgeColor,
  classificationLabel,
} from "@/lib/optimiser/scoring/classify";
import type { ScoreHistoryRow } from "@/lib/optimiser/scoring/score-history";

// §4.2 Score history view — full timeline of every score evaluation
// for a page. Slice 12 ships the table; Slice 13 wires the rollback
// action via the placeholder button. Tooltip explains the placeholder.

export function ScoreHistoryTable({
  history,
  causalDeltas,
}: {
  history: ScoreHistoryRow[];
  /** Slice 13 populates this; Slice 12 always passes an empty array. */
  causalDeltas?: Map<
    string,
    { actual_impact_cr?: number | null; actual_impact_score?: number | null }
  >;
}) {
  if (history.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No score history yet. Daily evaluation produces the first row
        within 24 hours of onboarding.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left">
          <tr>
            <th className="px-3 py-2">When</th>
            <th className="px-3 py-2">Composite</th>
            <th className="px-3 py-2">Classification</th>
            <th className="px-3 py-2 text-right">Align</th>
            <th className="px-3 py-2 text-right">Behav</th>
            <th className="px-3 py-2 text-right">Conv</th>
            <th className="px-3 py-2 text-right">Tech</th>
            <th className="px-3 py-2">Trigger</th>
            <th className="px-3 py-2">Causal delta</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {history.map((row, idx) => {
            const colours = classificationBadgeColor(row.classification);
            const isCurrent = idx === 0;
            const delta = causalDeltas?.get(row.id);
            return (
              <tr
                key={row.id}
                className={`border-t border-border ${
                  isCurrent ? "bg-emerald-50/40" : ""
                }`}
              >
                <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                  {new Date(row.evaluated_at).toLocaleString()}
                  {isCurrent && (
                    <span className="ml-2 text-emerald-700">current</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono font-semibold">
                  {row.composite_score}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${colours.bg} ${colours.border} ${colours.text}`}
                  >
                    <span aria-hidden className={`size-1.5 rounded-full ${colours.dot}`} />
                    {classificationLabel(row.classification)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {row.alignment_subscore ?? "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {row.behaviour_subscore ?? "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {row.conversion_subscore ?? "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {row.technical_subscore ?? "—"}
                </td>
                <td className="px-3 py-2 text-xs">
                  {row.triggering_proposal_id
                    ? row.change_set_summary ?? row.triggering_proposal_id.slice(0, 8) + "…"
                    : "—"}
                </td>
                <td className="px-3 py-2 text-xs">
                  {delta?.actual_impact_cr != null
                    ? `${delta.actual_impact_cr > 0 ? "+" : ""}${(delta.actual_impact_cr * 100).toFixed(1)}% CR`
                    : delta?.actual_impact_score != null
                      ? `${delta.actual_impact_score > 0 ? "+" : ""}${delta.actual_impact_score.toFixed(0)} pts`
                      : "—"}
                </td>
                <td className="px-3 py-2">
                  {!isCurrent && (
                    <button
                      type="button"
                      disabled
                      title="Rollback ships in the next update"
                      className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground"
                    >
                      Roll back
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
