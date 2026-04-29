import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ScoreBreakdownPanel } from "@/components/optimiser/ScoreBreakdownPanel";
import { ScoreHistoryTable } from "@/components/optimiser/ScoreHistoryTable";
import { ScoreSparkline } from "@/components/optimiser/ScoreSparkline";
import { getClient } from "@/lib/optimiser/clients";
import { getLandingPage } from "@/lib/optimiser/landing-pages";
import { computeReliability } from "@/lib/optimiser/data-reliability";
import { rollupForPage } from "@/lib/optimiser/metrics-aggregation";
import {
  computeBehaviourSubscore,
  type BehaviourCohortRow,
} from "@/lib/optimiser/scoring/behaviour-subscore";
import {
  computeCompositeScore,
  lowestContribution,
} from "@/lib/optimiser/scoring/composite-score";
import {
  computeConversionSubscore,
  costPerConversionFromRollup,
  type ConversionCohortRow,
} from "@/lib/optimiser/scoring/conversion-subscore";
import { computeTechnicalSubscore } from "@/lib/optimiser/scoring/technical-subscore";
import { listScoreHistory, listScoreSparkline } from "@/lib/optimiser/scoring/score-history";
import {
  DEFAULT_CONVERSION_COMPONENTS,
  DEFAULT_SCORE_WEIGHTS,
  type ConversionComponentsPresent,
  type ScoreWeights,
} from "@/lib/optimiser/scoring/types";
import { getServiceRoleClient } from "@/lib/supabase";

export const metadata = { title: "Optimiser · Page detail" };
export const dynamic = "force-dynamic";

export default async function OptimiserPageDetail({
  params,
}: {
  params: { id: string };
}) {
  const page = await getLandingPage(params.id);
  if (!page) notFound();
  const client = await getClient(page.client_id);
  if (!client) notFound();

  // Compute the live composite breakdown for the panel. The page row's
  // cached current_composite_score / current_classification feed the
  // page browser; the detail panel recomputes against the latest
  // rollup so the displayed sub-scores match what the user sees in
  // the metrics columns.
  const weights = (client.score_weights as ScoreWeights) ?? DEFAULT_SCORE_WEIGHTS;
  const componentsPresent =
    (client.conversion_components_present as ConversionComponentsPresent) ??
    DEFAULT_CONVERSION_COMPONENTS;

  const rollup = await rollupForPage(page.id);
  const reliability = computeReliability(rollup);

  const cohort = await fetchClientCohort(page.client_id);

  const supabase = getServiceRoleClient();
  const { data: alignmentRow } = await supabase
    .from("opt_alignment_scores")
    .select("score")
    .eq("landing_page_id", page.id)
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const alignmentScore = (alignmentRow?.score as number | null) ?? null;

  const behaviour = computeBehaviourSubscore(rollup, cohort.behaviour);
  const conversion = page.conversion_n_a
    ? null
    : computeConversionSubscore({
        rollup,
        cohort: cohort.conversion,
        componentsPresent,
        costPerConversionCents: costPerConversionFromRollup(rollup) ?? undefined,
      });
  const technical = computeTechnicalSubscore(rollup);

  const composite = computeCompositeScore({
    subscores: {
      alignment: alignmentScore,
      behaviour: behaviour?.score ?? null,
      conversion: conversion?.score ?? null,
      technical: technical?.score ?? null,
    },
    configuredWeights: weights,
    conversionNotApplicable: page.conversion_n_a,
  });

  const dragging = composite ? lowestContribution(composite) : null;
  const sparkline = await listScoreSparkline({
    landingPageId: page.id,
    limit: 10,
  });
  const history = await listScoreHistory({ landingPageId: page.id, limit: 30 });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            <Link href="/optimiser" className="text-primary underline-offset-4 hover:underline">
              ← Page browser
            </Link>{" "}
            · {client.name}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {page.display_name ?? page.url}
          </h1>
          <p className="font-mono text-xs text-muted-foreground">{page.url}</p>
        </div>
        <Button asChild variant="outline">
          <Link
            href={`/optimiser/clients/${client.id}/settings`}
          >
            Score weights
          </Link>
        </Button>
      </header>

      {composite ? (
        <ScoreBreakdownPanel
          result={composite}
          subscores={{
            alignment: alignmentScore,
            behaviour: behaviour?.score ?? null,
            conversion: conversion?.score ?? null,
            technical: technical?.score ?? null,
          }}
          reliability={reliability.reliability}
          draggingSubscore={dragging}
        />
      ) : (
        <section className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Gathering data — composite score available once §9.5 thresholds
          are met (sessions ≥ 100, freshness ≤ 7 days, behaviour data
          present).
        </section>
      )}

      <section className="space-y-3 rounded-lg border border-border bg-card p-6">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Score history</h2>
          {sparkline.length > 0 && (
            <ScoreSparkline
              points={sparkline.map((row) => ({
                value: row.composite_score,
                classification: row.classification,
                evaluated_at: row.evaluated_at,
              }))}
              width={240}
              height={56}
            />
          )}
        </header>
        <ScoreHistoryTable history={history} />
      </section>
    </div>
  );
}

async function fetchClientCohort(clientId: string): Promise<{
  behaviour: BehaviourCohortRow[];
  conversion: ConversionCohortRow[];
}> {
  const supabase = getServiceRoleClient();
  const { data: pages } = await supabase
    .from("opt_landing_pages")
    .select("id")
    .eq("client_id", clientId)
    .eq("managed", true)
    .is("deleted_at", null);
  const behaviour: BehaviourCohortRow[] = [];
  const conversion: ConversionCohortRow[] = [];
  for (const p of pages ?? []) {
    const r = await rollupForPage(p.id as string);
    behaviour.push({
      bounce_rate: r.bounce_rate > 0 ? r.bounce_rate : null,
      avg_engagement_time_s:
        r.avg_engagement_time_s > 0 ? r.avg_engagement_time_s : null,
      avg_scroll_depth: r.avg_scroll_depth > 0 ? r.avg_scroll_depth : null,
    });
    const cpa = costPerConversionFromRollup(r);
    conversion.push({
      conversion_rate: r.conversion_rate > 0 ? r.conversion_rate : null,
      cost_per_conversion: cpa,
    });
  }
  return { behaviour, conversion };
}
