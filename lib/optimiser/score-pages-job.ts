import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

import { scoreAlignment } from "./alignment-scoring";
import { suppressedPlaybooksFor } from "./client-memory";
import { computeReliability } from "./data-reliability";
import { evaluateAndPersistPage } from "./healthy-state";
import { rollupForPage } from "./metrics-aggregation";
import { analyseHtml } from "./page-content-analysis";
import {
  buildMetricBag,
  evaluatePlaybook,
  listPhase1ContentPlaybooks,
} from "./playbook-execution";
import { generateProposal } from "./proposal-generation";

// ---------------------------------------------------------------------------
// Score-pages job (Slice 5). Runs daily after the data-sync crons:
//   1. Iterate every managed landing page across all clients.
//   2. Fetch the live URL → analyseHtml → snapshot.
//   3. Pull the page's keywords + ads from the joined ad-group(s).
//   4. Score alignment → upsert opt_alignment_scores.
//   5. Build the metric bag → evaluate Phase 1 content playbooks.
//   6. Each fired playbook → generateProposal (idempotent on
//      (page, playbook) for active proposals).
//   7. Re-run healthy-state evaluation with the fresh inputs.
//
// Per-page failure isolated. Rate-limited HTML fetch with a soft cap
// per tick.
// ---------------------------------------------------------------------------

const MAX_PAGES_PER_TICK = 200;

export type ScorePagesOutcome = {
  client_id: string;
  pages_scored: number;
  proposals_generated: number;
  errors: number;
};

export async function runScorePagesForAllClients(): Promise<{
  outcomes: ScorePagesOutcome[];
  total_pages: number;
}> {
  const supabase = getServiceRoleClient();
  const playbooks = await listPhase1ContentPlaybooks();

  const { data: pages, error } = await supabase
    .from("opt_landing_pages")
    .select("id, client_id, url, management_mode, page_snapshot")
    .eq("managed", true)
    .is("deleted_at", null)
    .limit(MAX_PAGES_PER_TICK);
  if (error) {
    throw new Error(`runScorePagesForAllClients: ${error.message}`);
  }

  const byClient = new Map<string, ScorePagesOutcome>();
  const suppressedByClient = new Map<string, Set<string>>();
  let total_pages = 0;

  for (const page of pages ?? []) {
    const clientId = page.client_id as string;
    if (!byClient.has(clientId)) {
      byClient.set(clientId, {
        client_id: clientId,
        pages_scored: 0,
        proposals_generated: 0,
        errors: 0,
      });
      suppressedByClient.set(
        clientId,
        await suppressedPlaybooksFor(clientId),
      );
    }
    const outcome = byClient.get(clientId)!;
    try {
      const generated = await scoreAndProposeForPage({
        landingPageId: page.id as string,
        clientId,
        url: page.url as string,
        managementMode: page.management_mode as
          | "read_only"
          | "full_automation",
        playbooks,
        suppressed: suppressedByClient.get(clientId) ?? new Set(),
      });
      outcome.pages_scored += 1;
      outcome.proposals_generated += generated;
      total_pages += 1;
    } catch (err) {
      outcome.errors += 1;
      logger.error("optimiser.score_pages.failed", {
        client_id: clientId,
        landing_page_id: page.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { outcomes: [...byClient.values()], total_pages };
}

async function scoreAndProposeForPage(args: {
  landingPageId: string;
  clientId: string;
  url: string;
  managementMode: "read_only" | "full_automation";
  playbooks: Awaited<ReturnType<typeof listPhase1ContentPlaybooks>>;
  suppressed: Set<string>;
}): Promise<number> {
  const supabase = getServiceRoleClient();

  // 1. Fetch + analyse HTML
  let snapshot;
  try {
    const res = await fetch(args.url, {
      redirect: "follow",
      headers: { "user-agent": "Opollo-Optimiser/1.0 (+score-pages)" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const html = await res.text();
    snapshot = analyseHtml(args.url, html);
  } catch (err) {
    logger.warn("optimiser.score_pages.fetch_failed", {
      url: args.url,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }

  // Persist the snapshot back onto the page row.
  await supabase
    .from("opt_landing_pages")
    .update({
      page_snapshot: snapshot,
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.landingPageId);

  // 2. Resolve the ad group(s) for this page. Phase 1: Ads
  // landing_page_view sync (Slice 2 follow-up) populates a join from
  // (page → ad_group). For now we walk opt_ads.final_url == page.url
  // to locate ad groups that point at this URL.
  const { data: adsForPage } = await supabase
    .from("opt_ads")
    .select("id, ad_group_id, headlines, descriptions")
    .eq("client_id", args.clientId)
    .eq("final_url", args.url)
    .is("deleted_at", null);

  // Run alignment for the first ad group found (Slice 5 ships single-
  // best-match; multi-ad-group is a Slice 5.1 follow-up since the
  // proposal carries a single ad_group_id).
  const adGroupId = adsForPage?.[0]?.ad_group_id as string | null;
  let alignmentScore: number | null = null;
  let alignmentSubscores: Record<string, number> | null = null;

  if (adGroupId) {
    const { data: keywordRows } = await supabase
      .from("opt_keywords")
      .select("text, match_type")
      .eq("ad_group_id", adGroupId)
      .is("deleted_at", null)
      .limit(20);
    const headlines: string[] = [];
    const descriptions: string[] = [];
    for (const ad of adsForPage ?? []) {
      headlines.push(...((ad.headlines ?? []) as string[]));
      descriptions.push(...((ad.descriptions ?? []) as string[]));
    }
    const result = scoreAlignment({
      snapshot,
      keywords: (keywordRows ?? []) as Array<{ text: string; match_type?: string }>,
      ad_headlines: headlines,
      ad_descriptions: descriptions,
    });
    alignmentScore = result.composite;
    alignmentSubscores = result.subscores as unknown as Record<string, number>;

    await supabase.from("opt_alignment_scores").upsert(
      {
        client_id: args.clientId,
        ad_group_id: adGroupId,
        landing_page_id: args.landingPageId,
        score: result.composite,
        keyword_relevance: result.subscores.keyword_relevance,
        ad_to_page_match: result.subscores.ad_to_page_match,
        cta_consistency: result.subscores.cta_consistency,
        offer_clarity: result.subscores.offer_clarity,
        intent_match: result.subscores.intent_match,
        rationale: result.rationale,
        input_fingerprint: result.input_fingerprint,
        computed_at: new Date().toISOString(),
      },
      { onConflict: "ad_group_id,landing_page_id" },
    );
  }

  // 3. Rollup + reliability + healthy state.
  const rollup = await rollupForPage(args.landingPageId);
  const reliability = computeReliability(rollup);

  // 4. Evaluate playbooks.
  const ctaVerbMatch = (() => {
    const adVerb = inferAdCtaVerb(adsForPage);
    const pageVerb = snapshot.primary_cta?.verb ?? null;
    if (!adVerb || !pageVerb) return null;
    return adVerb === pageVerb;
  })();

  const bag = buildMetricBag({
    rollup,
    snapshot,
    alignmentScore,
    ctaVerbMatch,
  });

  let proposalsGenerated = 0;
  const firedPlaybookIds: string[] = [];
  for (const playbook of args.playbooks) {
    const evaluation = evaluatePlaybook(playbook, bag);
    if (!evaluation.fired) continue;
    firedPlaybookIds.push(playbook.id);
    try {
      const r = await generateProposal({
        clientId: args.clientId,
        landingPageId: args.landingPageId,
        adGroupId,
        playbook,
        rollup,
        alignmentScore,
        alignmentSubscores,
        triggerEvidence: evaluation.reasons,
        triggerMagnitude: evaluation.magnitude,
        suppressed: args.suppressed,
      });
      if (r.inserted) proposalsGenerated += 1;
    } catch (err) {
      logger.warn("optimiser.score_pages.proposal_failed", {
        playbook: playbook.id,
        landing_page_id: args.landingPageId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 5. Re-run healthy state with the new alignment + playbook inputs.
  await evaluateAndPersistPage({
    landingPageId: args.landingPageId,
    clientId: args.clientId,
    managementMode: args.managementMode,
    rollup,
    reliability,
    clientActiveAvgCr: null,
  });
  void firedPlaybookIds; // forwarded into healthy-state eval in a
  // follow-up; healthy-state currently reads alignment from the
  // alignment_scores row directly.

  return proposalsGenerated;
}

function inferAdCtaVerb(
  ads:
    | Array<{ headlines?: string[]; descriptions?: string[] }>
    | null
    | undefined,
): string | null {
  if (!ads) return null;
  const verbs = new Set([
    "get",
    "start",
    "book",
    "request",
    "download",
    "buy",
    "order",
    "contact",
    "claim",
    "subscribe",
    "try",
    "schedule",
    "join",
  ]);
  for (const ad of ads) {
    for (const text of [...(ad.headlines ?? []), ...(ad.descriptions ?? [])]) {
      const tokens = text.toLowerCase().split(/\s+/);
      for (const tok of tokens) {
        const clean = tok.replace(/[^a-z]/g, "");
        if (verbs.has(clean)) return clean;
      }
    }
  }
  return null;
}
