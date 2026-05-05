import Link from "next/link";

import type { RolloutRow } from "@/lib/optimiser/staged-rollout/read";

// Staged-rollout banner (Phase 1.5 follow-up) — surfaces on the page
// detail view alongside AbTestStatusBanner. Renders the most recent
// opt_staged_rollouts row's state so operators can see the rollout
// lifecycle without leaving the page.
//
// Server-renderable, read-only.

const STATE_TONE: Record<string, string> = {
  live: "border-blue-200 bg-blue-50 text-blue-900",
  promoted: "border-emerald-200 bg-emerald-50 text-emerald-900",
  manually_promoted: "border-emerald-200 bg-emerald-50 text-emerald-900",
  auto_reverted: "border-red-200 bg-red-50 text-red-900",
  failed: "border-amber-200 bg-amber-50 text-amber-900",
};

const STATE_LABEL: Record<string, string> = {
  live: "rolling out",
  promoted: "promoted",
  manually_promoted: "manually promoted",
  auto_reverted: "auto-reverted",
  failed: "monitor failed",
};

export function StagedRolloutBanner({ rollout }: { rollout: RolloutRow | null }) {
  if (!rollout) return null;
  const tone = STATE_TONE[rollout.current_state] ?? STATE_TONE.live;
  const label = STATE_LABEL[rollout.current_state] ?? rollout.current_state;
  const observed = rollout.latest_evaluation?.observed as
    | {
        cr_new?: number;
        cr_baseline?: number;
        cr_drop_pct?: number;
        bounce_new?: number;
        bounce_baseline?: number;
        bounce_spike_pct?: number;
        error_rate?: number;
        floors_met?: { sessions: boolean; conversions: boolean; time: boolean };
      }
    | undefined;
  const trips = rollout.latest_evaluation?.trips ?? [];

  return (
    <section className={`rounded-lg border p-4 ${tone}`}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          Staged rollout ({label})
        </h3>
        <p className="text-sm opacity-80">
          Split: {rollout.traffic_split_percent}%
          {" · "}
          started {new Date(rollout.started_at).toLocaleString()}
          {rollout.ended_at && (
            <>
              {" · ended "}
              {new Date(rollout.ended_at).toLocaleString()}
              {rollout.end_reason && <> ({rollout.end_reason})</>}
            </>
          )}
        </p>
      </header>

      {observed && (
        <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <li>
            <span className="opacity-70">CR (new): </span>
            <span className="font-mono tabular-nums">
              {fmtPct(observed.cr_new)}
            </span>
            <span className="opacity-70">
              {" vs baseline "}
              {fmtPct(observed.cr_baseline)}
            </span>
            {typeof observed.cr_drop_pct === "number" &&
              observed.cr_drop_pct > 0 && (
                <span className="ml-1 opacity-70">
                  (drop {(observed.cr_drop_pct * 100).toFixed(1)}%)
                </span>
              )}
          </li>
          <li>
            <span className="opacity-70">Bounce (new): </span>
            <span className="font-mono tabular-nums">
              {fmtPct(observed.bounce_new)}
            </span>
            <span className="opacity-70">
              {" vs baseline "}
              {fmtPct(observed.bounce_baseline)}
            </span>
          </li>
          <li>
            <span className="opacity-70">Error rate: </span>
            <span className="font-mono tabular-nums">
              {fmtPct(observed.error_rate)}
            </span>
            <span className="ml-1 opacity-60">
              (5xx feed not yet ingested — defaults to 0)
            </span>
          </li>
          <li>
            <span className="opacity-70">Floors met: </span>
            <span className="font-mono tabular-nums">
              {observed.floors_met
                ? [
                    observed.floors_met.sessions ? "sessions" : null,
                    observed.floors_met.conversions ? "conversions" : null,
                    observed.floors_met.time ? "time" : null,
                  ]
                    .filter(Boolean)
                    .join(" + ") || "none"
                : "—"}
            </span>
          </li>
        </ul>
      )}

      {trips.length > 0 && (
        <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm">
          {trips.map((t, i) => (
            <li key={i} className="font-mono">{t}</li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-sm opacity-70">
        {rollout.evaluation_count > 0 ? (
          <>
            {rollout.evaluation_count} monitor evaluation
            {rollout.evaluation_count === 1 ? "" : "s"} recorded
            {rollout.latest_evaluation && (
              <>
                {" · last "}
                {new Date(
                  rollout.latest_evaluation.evaluated_at,
                ).toLocaleString()}
              </>
            )}
            {" · "}
          </>
        ) : (
          <>Awaiting first monitor tick · </>
        )}
        <Link
          href={`/optimiser/proposals/${rollout.proposal_id}`}
          className="underline-offset-4 hover:underline"
        >
          source proposal
        </Link>
      </p>
    </section>
  );
}

function fmtPct(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}
