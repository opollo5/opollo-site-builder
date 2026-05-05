import type { PatternRow } from "@/lib/optimiser/pattern-library/types";

// "Cross-client priors" panel — Phase 3 Slice 23 (§11.2).
//
// Surfaces on the proposal review screen alongside the past-causal-
// deltas panel. Reads from opt_pattern_library through
// listRelevantPatterns(). Renders only when:
//   - The feature flag is on (caller's responsibility — server fetches
//     listRelevantPatterns which short-circuits to [] when off)
//   - The receiving client has cross_client_learning_consent=true
//   - At least one pattern matches the proposal's playbook
//
// Anonymisation: every field shown here is structural — no client
// names, no URLs, no copy.

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "high confidence",
  moderate: "moderate confidence",
  low: "low confidence",
};

const CONFIDENCE_COLOUR: Record<string, string> = {
  high: "border-emerald-200 bg-emerald-50 text-emerald-900",
  moderate: "border-blue-200 bg-blue-50 text-blue-900",
  low: "border-muted-foreground/20 bg-muted text-muted-foreground",
};

export function PatternPriorsPanel({
  patterns,
  playbookId,
}: {
  patterns: PatternRow[];
  playbookId: string | null;
}) {
  if (!playbookId) return null;
  if (patterns.length === 0) return null;

  // Pick the highest-confidence pattern for the headline summary; show
  // the others as supporting rows.
  const top = patterns[0];
  const colour = CONFIDENCE_COLOUR[top.confidence] ?? CONFIDENCE_COLOUR.low;
  const label = CONFIDENCE_LABEL[top.confidence] ?? "low confidence";
  const meanPp = Number(top.effect_pp_mean);
  const ciLow = Number(top.effect_pp_ci_low);
  const ciHigh = Number(top.effect_pp_ci_high);
  const sign = meanPp >= 0 ? "+" : "";

  return (
    <section className={`rounded-md border p-4 text-sm ${colour}`}>
      <header className="space-y-1">
        <p className="font-medium">
          Cross-client priors
          <span className="ml-2 text-sm uppercase tracking-wide opacity-80">
            anonymised, {label}
          </span>
        </p>
        <p>
          Past <strong>{top.sample_size_observations}</strong> proposals across{" "}
          <strong>{top.sample_size_clients}</strong> consenting clients
          using <strong>{playbookId.replace(/_/g, " ")}</strong> averaged{" "}
          <strong>
            {sign}
            {meanPp.toFixed(1)}pp CR
          </strong>{" "}
          (95% CI: {ciLow.toFixed(1)} to {ciHigh.toFixed(1)}).
        </p>
        <p className="text-sm opacity-80">
          Pattern: <em>{top.observation}</em>
        </p>
      </header>
      {patterns.length > 1 && (
        <ul className="mt-3 space-y-1 text-sm opacity-90">
          {patterns.slice(1, 4).map((p) => {
            const m = Number(p.effect_pp_mean);
            const s = m >= 0 ? "+" : "";
            return (
              <li key={p.id}>
                · {p.observation}: {s}
                {m.toFixed(1)}pp ({p.sample_size_clients} clients,{" "}
                {p.confidence})
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-sm opacity-70">
        Cross-client patterns are anonymised structural observations
        only — no client names, URLs, copy, testimonials, or pricing
        leave the contributing accounts. Per spec §11.2.
      </p>
    </section>
  );
}
