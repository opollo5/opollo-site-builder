import {
  classificationBadgeColor,
  classificationLabel,
} from "@/lib/optimiser/scoring/classify";
import type {
  CompositeResult,
  SubscoreBundle,
} from "@/lib/optimiser/scoring/types";

// Score breakdown panel — addendum §4.1.
//
// Server component. Renders:
//   - Composite score (large) + classification badge + reliability dot
//   - Four horizontal bars showing each sub-score's weighted contribution
//   - One-line interpretation pointing at the lowest-contribution sub-score

const PLAYBOOK_HINT_BY_SUBSCORE: Record<
  keyof SubscoreBundle,
  { label: string; playbooks: string[] }
> = {
  alignment: {
    label: "Alignment",
    playbooks: ["Message mismatch", "CTA verb mismatch"],
  },
  behaviour: {
    label: "Behaviour",
    playbooks: ["Weak above-the-fold", "Form friction"],
  },
  conversion: {
    label: "Conversion",
    playbooks: ["Offer clarity", "Trust gap"],
  },
  technical: {
    label: "Technical",
    playbooks: ["Page speed alert"],
  },
};

export function ScoreBreakdownPanel({
  result,
  subscores,
  reliability,
  draggingSubscore,
}: {
  result: CompositeResult;
  subscores: SubscoreBundle;
  reliability: "green" | "amber" | "red";
  draggingSubscore: keyof SubscoreBundle | null;
}) {
  const colours = classificationBadgeColor(result.classification);
  const reliabilityColour =
    reliability === "green"
      ? "bg-emerald-500"
      : reliability === "amber"
        ? "bg-amber-400"
        : "bg-red-500";
  return (
    <section className="space-y-5 rounded-lg border border-border bg-card p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Composite score
          </p>
          <p className="mt-1 flex items-center gap-3">
            <span className="text-4xl font-semibold tabular-nums">
              {result.composite_score}
            </span>
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium ${colours.bg} ${colours.border} ${colours.text}`}
            >
              <span aria-hidden className={`size-2 rounded-full ${colours.dot}`} />
              {classificationLabel(result.classification)}
            </span>
            <span
              aria-hidden
              className={`size-2.5 rounded-full ${reliabilityColour}`}
              title={`Data reliability: ${reliability}`}
            />
          </p>
        </div>
      </header>

      <div className="space-y-2">
        <SubscoreBar
          label="Alignment"
          value={subscores.alignment}
          weight={result.weights_used.alignment}
          contribution={result.contributions.alignment}
          highlight={draggingSubscore === "alignment"}
        />
        <SubscoreBar
          label="Behaviour"
          value={subscores.behaviour}
          weight={result.weights_used.behaviour}
          contribution={result.contributions.behaviour}
          highlight={draggingSubscore === "behaviour"}
        />
        <SubscoreBar
          label="Conversion"
          value={subscores.conversion}
          weight={result.weights_used.conversion}
          contribution={result.contributions.conversion}
          highlight={draggingSubscore === "conversion"}
        />
        <SubscoreBar
          label="Technical"
          value={subscores.technical}
          weight={result.weights_used.technical}
          contribution={result.contributions.technical}
          highlight={draggingSubscore === "technical"}
        />
      </div>

      {draggingSubscore && (
        <p className="rounded-md bg-muted/50 p-3 text-sm">
          <span className="font-medium">What&apos;s dragging this score down:</span>{" "}
          {PLAYBOOK_HINT_BY_SUBSCORE[draggingSubscore].label} is the
          weakest sub-score. Two relevant playbooks:{" "}
          {PLAYBOOK_HINT_BY_SUBSCORE[draggingSubscore].playbooks.join(", ")}.
        </p>
      )}
      {!draggingSubscore && result.classification === "high_performer" && (
        <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
          Performing within expected range across all sub-scores. No
          action needed unless a playbook trigger fires.
        </p>
      )}

      {result.redistribution_applied && (
        <p className="text-xs text-muted-foreground">
          Note: weights redistributed because some sub-scores didn&apos;t
          have enough data or the page is flagged conversion_n_a.
        </p>
      )}
    </section>
  );
}

function SubscoreBar({
  label,
  value,
  weight,
  contribution,
  highlight,
}: {
  label: string;
  value: number | null;
  weight: number;
  contribution: number;
  highlight: boolean;
}) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const isUnused = weight === 0;
  return (
    <div
      className={`rounded-md ${
        highlight ? "border border-amber-200 bg-amber-50/60 p-2" : "p-1"
      }`}
    >
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {value == null
            ? isUnused
              ? "(not weighted)"
              : "(insufficient data)"
            : `${value} (×${weight.toFixed(2)} = ${contribution.toFixed(1)})`}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
        {value != null && !isUnused && (
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </div>
  );
}
