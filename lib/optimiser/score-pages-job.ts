import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

import { scoreAlignment } from "./alignment-scoring";
import { suppressedPlaybooksFor } from "./client-memory";
import { scoreAlignmentLlm } from "./llm-alignment";
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
  let llmFallbackEngaged = false;

  if (adGroupId) {
    const [{ data: keywordRows }, { data: adGroupRow }] = await Promise.all([
      supabase
        .from("opt_keywords")
        .select("text, match_type")
        .eq("ad_group_id", adGroupId)
        .is("deleted_at", null)
        .limit(20),
      supabase
        .from("opt_ad_groups")
        .select("raw")
        .eq("id", adGroupId)
        .maybeSingle(),
    ]);
    const headlines: string[] = [];
    const descriptions: string[] = [];
    for (const ad of adsForPage ?? []) {
      headlines.push(...((ad.headlines ?? []) as string[]));
      descriptions.push(...((ad.descriptions ?? []) as string[]));
    }
    const topSearchTerms = extractTopSearchTerms(adGroupRow?.raw);
    const rulesResult = scoreAlignment({
      snapshot,
      keywords: (keywordRows ?? []) as Array<{ text: string; match_type?: string }>,
      ad_headlines: headlines,
      ad_descriptions: descriptions,
      search_terms: topSearchTerms,
    });

    // Cache check: if the existing row's input_fingerprint matches and
    // it's < 24h old, reuse the row and skip the LLM call entirely.
    const { data: existing } = await supabase
      .from("opt_alignment_scores")
      .select("score, ad_to_page_match, intent_match, input_fingerprint, computed_at, rationale")
      .eq("ad_group_id", adGroupId)
      .eq("landing_page_id", args.landingPageId)
      .maybeSingle();
    const cacheFresh =
      existing &&
      existing.input_fingerprint === rulesResult.input_fingerprint &&
      existing.computed_at &&
      Date.now() - new Date(existing.computed_at as string).getTime() <
        24 * 60 * 60 * 1000;

    if (cacheFresh && existing) {
      alignmentScore = existing.score as number;
      alignmentSubscores = {
        keyword_relevance: rulesResult.subscores.keyword_relevance,
        ad_to_page_match: existing.ad_to_page_match as number,
        cta_consistency: rulesResult.subscores.cta_consistency,
        offer_clarity: rulesResult.subscores.offer_clarity,
        intent_match: existing.intent_match as number,
      };
      // No LLM call → no fallback flag; the cached row already
      // captured whatever the original LLM verdict was.
    } else {
      // Fresh inputs (or no prior row). Run the LLM hybrid pass on
      // ad_to_page_match + intent_match only; keep keyword_relevance,
      // cta_consistency, and offer_clarity as rules-based.
      const llm = await scoreAlignmentLlm({
        clientId: args.clientId,
        adGroupId,
        landingPageId: args.landingPageId,
        snapshot,
        adHeadlines: headlines,
        adDescriptions: descriptions,
        searchTerms: topSearchTerms,
        rulesAdToPageMatch: rulesResult.subscores.ad_to_page_match,
        rulesIntentMatch: rulesResult.subscores.intent_match,
      });
      llmFallbackEngaged = llm.fallback_engaged;

      const merged = {
        ...rulesResult.subscores,
        ad_to_page_match: llm.ad_to_page_match.score,
        intent_match: llm.intent_match.score,
      };
      const composite = recomputeComposite(merged);
      alignmentScore = composite;
      alignmentSubscores = merged as unknown as Record<string, number>;

      const augmentedRationale = [
        ...rulesResult.rationale,
        {
          subscore: "ad_to_page_match",
          note: `LLM (${llm.ad_to_page_match.source}): ${llm.ad_to_page_match.rationale}`,
        },
        {
          subscore: "intent_match",
          note: `LLM (${llm.intent_match.source}): ${llm.intent_match.rationale}`,
        },
      ];

      await supabase.from("opt_alignment_scores").upsert(
        {
          client_id: args.clientId,
          ad_group_id: adGroupId,
          landing_page_id: args.landingPageId,
          score: composite,
          keyword_relevance: merged.keyword_relevance,
          ad_to_page_match: merged.ad_to_page_match,
          cta_consistency: merged.cta_consistency,
          offer_clarity: merged.offer_clarity,
          intent_match: merged.intent_match,
          rationale: augmentedRationale,
          input_fingerprint: rulesResult.input_fingerprint,
          computed_at: new Date().toISOString(),
        },
        { onConflict: "ad_group_id,landing_page_id" },
      );
    }
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
      // §8 LLM hybrid: when the LLM call fell back to rules, penalise
      // the confidence signal sub-factor by 0.7 so the proposal
      // priority reflects the lower-quality signal.
      const adjustedMagnitude = llmFallbackEngaged
        ? evaluation.magnitude * 0.7
        : evaluation.magnitude;
      const r = await generateProposal({
        clientId: args.clientId,
        landingPageId: args.landingPageId,
        adGroupId,
        playbook,
        rollup,
        alignmentScore,
        alignmentSubscores,
        triggerEvidence: evaluation.reasons,
        triggerMagnitude: adjustedMagnitude,
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

const SUBSCORE_WEIGHTS = {
  keyword_relevance: 0.25,
  ad_to_page_match: 0.25,
  cta_consistency: 0.15,
  offer_clarity: 0.2,
  intent_match: 0.15,
} as const;

function recomputeComposite(s: {
  keyword_relevance: number;
  ad_to_page_match: number;
  cta_consistency: number;
  offer_clarity: number;
  intent_match: number;
}): number {
  return Math.round(
    s.keyword_relevance * SUBSCORE_WEIGHTS.keyword_relevance +
      s.ad_to_page_match * SUBSCORE_WEIGHTS.ad_to_page_match +
      s.cta_consistency * SUBSCORE_WEIGHTS.cta_consistency +
      s.offer_clarity * SUBSCORE_WEIGHTS.offer_clarity +
      s.intent_match * SUBSCORE_WEIGHTS.intent_match,
  );
}

function extractTopSearchTerms(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const top = (raw as { top_search_terms?: unknown }).top_search_terms;
  if (!Array.isArray(top)) return [];
  return top
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        const t = (entry as { term?: unknown }).term;
        if (typeof t === "string") return t;
      }
      return null;
    })
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .slice(0, 30);
}
