import type { TestRow } from "@/lib/optimiser/variants/types";

// A/B test status banner (Slice 19) — surfaces on the page detail view
// when a test is queued / running / decided. Server-renderable.

export function AbTestStatusBanner({ test }: { test: TestRow | null }) {
  if (!test) return null;
  const snapshot = (test.last_metrics_snapshot ?? {}) as {
    a?: { sessions?: number; conversions?: number };
    b?: { sessions?: number; conversions?: number };
    evaluated_at?: string;
  };
  const sessionsA = snapshot.a?.sessions ?? 0;
  const sessionsB = snapshot.b?.sessions ?? 0;
  const conversionsA = snapshot.a?.conversions ?? 0;
  const conversionsB = snapshot.b?.conversions ?? 0;
  const probA = test.winner_probability_a;
  const probB = test.winner_probability_b;

  const tone =
    test.status === "winner_a" || test.status === "winner_b"
      ? "ok"
      : test.status === "inconclusive" || test.status === "stopped"
        ? "warn"
        : "info";
  const colours =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-blue-200 bg-blue-50 text-blue-900";

  return (
    <section className={`rounded-lg border p-4 ${colours}`}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          A/B test ({test.status.replace("_", " ")})
        </h3>
        <p className="text-xs text-muted-foreground">
          Split: B {test.traffic_split_percent}% / A {100 - test.traffic_split_percent}%
          {test.started_at && (
            <>
              {" "}
              · started{" "}
              {new Date(test.started_at).toLocaleString()}
            </>
          )}
          {test.ended_at && (
            <>
              {" "}
              · ended{" "}
              {new Date(test.ended_at).toLocaleString()}
              {test.ended_reason && <> ({test.ended_reason})</>}
            </>
          )}
        </p>
      </header>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <VariantPanel
          label="A (control)"
          sessions={sessionsA}
          conversions={conversionsA}
          probability={probA}
          isWinner={test.status === "winner_a"}
        />
        <VariantPanel
          label="B (challenger)"
          sessions={sessionsB}
          conversions={conversionsB}
          probability={probB}
          isWinner={test.status === "winner_b"}
        />
      </div>
      {snapshot.evaluated_at && (
        <p className="mt-2 text-xs text-muted-foreground">
          Last evaluated: {new Date(snapshot.evaluated_at).toLocaleString()}
        </p>
      )}
    </section>
  );
}

function VariantPanel({
  label,
  sessions,
  conversions,
  probability,
  isWinner,
}: {
  label: string;
  sessions: number;
  conversions: number;
  probability: number | null;
  isWinner: boolean;
}) {
  const cr = sessions > 0 ? (conversions / sessions) * 100 : 0;
  return (
    <div
      className={`rounded-md border p-3 ${
        isWinner
          ? "border-emerald-300 bg-emerald-50/60"
          : "border-border bg-background/60"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        {isWinner && (
          <span className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            winner
          </span>
        )}
      </div>
      <ul className="mt-2 space-y-0.5 text-sm">
        <li>
          <span className="text-muted-foreground">Sessions: </span>
          <span className="font-mono tabular-nums">{sessions.toLocaleString()}</span>
        </li>
        <li>
          <span className="text-muted-foreground">Conversions: </span>
          <span className="font-mono tabular-nums">
            {conversions.toLocaleString()}
          </span>
        </li>
        <li>
          <span className="text-muted-foreground">CR: </span>
          <span className="font-mono tabular-nums">{cr.toFixed(2)}%</span>
        </li>
        <li>
          <span className="text-muted-foreground">Probability of being best: </span>
          <span className="font-mono tabular-nums">
            {probability == null ? "—" : `${(probability * 100).toFixed(1)}%`}
          </span>
        </li>
      </ul>
    </div>
  );
}
