import "server-only";

import type { PageSnapshot } from "./page-content-analysis";

// ---------------------------------------------------------------------------
// Alignment scoring (spec §8). Five sub-scores, each 0–100.
//
// Phase 1 ships a deterministic rules-only scoring pass. The spec's
// "rules + LLM hybrid" calls for LLM augmentation on keyword_relevance,
// ad_to_page_match, offer_clarity, and intent_match (semantic equiv +
// classification). The hybrid hook is documented in the SKILL.md;
// LLM calls are gated on opt_clients.llm_monthly_budget_usd via
// lib/optimiser/llm-usage.ts:gateLlmCall.
//
// Why ship rules-only first: a deterministic baseline is reproducible,
// testable, and lets the engine begin generating proposals for high-
// signal cases (exact keyword absence, CTA verb mismatch, form size)
// without LLM cost. The LLM augmentation fills in the semantic gap on
// borderline cases — Slice 5.5 / Phase 1.5.
// ---------------------------------------------------------------------------

export type AlignmentSubscores = {
  keyword_relevance: number;
  ad_to_page_match: number;
  cta_consistency: number;
  offer_clarity: number;
  intent_match: number;
};

export type AlignmentScoreInputs = {
  snapshot: PageSnapshot;
  /** Top-spending keywords for the ad group. */
  keywords: Array<{ text: string; match_type?: string }>;
  /** Headlines of the highest-volume RSA in the ad group. */
  ad_headlines: string[];
  /** Descriptions of the same RSA. */
  ad_descriptions: string[];
  /** Search-term sample (Phase 1 not always available; pass empty []). */
  search_terms?: string[];
};

export type AlignmentScore = {
  composite: number;
  subscores: AlignmentSubscores;
  rationale: Array<{ subscore: keyof AlignmentSubscores; note: string }>;
  input_fingerprint: string;
};

const SUBSCORE_WEIGHTS: Record<keyof AlignmentSubscores, number> = {
  keyword_relevance: 0.25,
  ad_to_page_match: 0.25,
  cta_consistency: 0.15,
  offer_clarity: 0.2,
  intent_match: 0.15,
};

export function scoreAlignment(inputs: AlignmentScoreInputs): AlignmentScore {
  const rationale: AlignmentScore["rationale"] = [];

  // 1. Keyword relevance — does the ad group's top keyword(s) appear in
  //    H1, H2s, or primary CTA?
  const keywordRelevance = scoreKeywordRelevance(inputs, rationale);

  // 2. Ad-to-page match — overlap between ad headline tokens and hero excerpt.
  const adToPageMatch = scoreAdToPageMatch(inputs, rationale);

  // 3. CTA consistency — does the ad's CTA verb match the page's primary CTA?
  const ctaConsistency = scoreCtaConsistency(inputs, rationale);

  // 4. Offer clarity — is the offer (heuristic) stated above the fold?
  const offerClarity = scoreOfferClarity(inputs, rationale);

  // 5. Intent match — coarse classification of search-term intent vs.
  //    page type (form-heavy = transactional, blog-heavy = informational).
  const intentMatch = scoreIntentMatch(inputs, rationale);

  const subscores: AlignmentSubscores = {
    keyword_relevance: keywordRelevance,
    ad_to_page_match: adToPageMatch,
    cta_consistency: ctaConsistency,
    offer_clarity: offerClarity,
    intent_match: intentMatch,
  };

  const composite = Math.round(
    (Object.entries(subscores) as Array<[keyof AlignmentSubscores, number]>).reduce(
      (acc, [k, v]) => acc + v * SUBSCORE_WEIGHTS[k],
      0,
    ),
  );

  return {
    composite,
    subscores,
    rationale,
    input_fingerprint: fingerprint(inputs),
  };
}

function tokenise(s: string | null): Set<string> {
  if (!s) return new Set();
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3),
  );
}

function setOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const v of a) if (b.has(v)) intersect += 1;
  return intersect / Math.min(a.size, b.size);
}

function scoreKeywordRelevance(
  inputs: AlignmentScoreInputs,
  rationale: AlignmentScore["rationale"],
): number {
  const heroBag = tokenise(
    [
      inputs.snapshot.h1 ?? "",
      ...inputs.snapshot.h2s,
      inputs.snapshot.title ?? "",
      inputs.snapshot.primary_cta?.text ?? "",
    ].join(" "),
  );
  if (inputs.keywords.length === 0) {
    rationale.push({
      subscore: "keyword_relevance",
      note: "no keywords for ad group — score from page-fingerprint only",
    });
    return 50;
  }
  const top = inputs.keywords.slice(0, 5);
  let hits = 0;
  for (const kw of top) {
    const kwTokens = tokenise(kw.text);
    const overlap = setOverlap(kwTokens, heroBag);
    if (overlap >= 0.5) hits += 1;
  }
  const ratio = hits / top.length;
  rationale.push({
    subscore: "keyword_relevance",
    note: `${hits}/${top.length} top keywords appear in H1/H2/CTA`,
  });
  return Math.round(ratio * 100);
}

function scoreAdToPageMatch(
  inputs: AlignmentScoreInputs,
  rationale: AlignmentScore["rationale"],
): number {
  const adBag = tokenise(
    [...inputs.ad_headlines, ...inputs.ad_descriptions].join(" "),
  );
  const pageBag = tokenise(
    [
      inputs.snapshot.h1 ?? "",
      ...inputs.snapshot.h2s,
      inputs.snapshot.hero_excerpt ?? "",
    ].join(" "),
  );
  const overlap = setOverlap(adBag, pageBag);
  rationale.push({
    subscore: "ad_to_page_match",
    note: `ad↔page token overlap ${(overlap * 100).toFixed(0)}%`,
  });
  return Math.round(Math.min(1, overlap * 1.4) * 100);
}

const COMMON_CTA_VERBS = new Set([
  "get",
  "start",
  "book",
  "request",
  "download",
  "buy",
  "order",
  "contact",
  "claim",
  "sign",
  "subscribe",
  "try",
  "schedule",
  "join",
  "free",
]);

function scoreCtaConsistency(
  inputs: AlignmentScoreInputs,
  rationale: AlignmentScore["rationale"],
): number {
  const pageVerb = inputs.snapshot.primary_cta?.verb ?? null;
  const adVerb = extractCtaVerb([...inputs.ad_headlines, ...inputs.ad_descriptions]);
  if (!pageVerb || !adVerb) {
    rationale.push({
      subscore: "cta_consistency",
      note: "could not detect both ad and page CTA verbs",
    });
    return 60;
  }
  if (pageVerb === adVerb) {
    rationale.push({
      subscore: "cta_consistency",
      note: `verbs match: '${pageVerb}'`,
    });
    return 100;
  }
  if (
    COMMON_CTA_VERBS.has(pageVerb) &&
    COMMON_CTA_VERBS.has(adVerb)
  ) {
    rationale.push({
      subscore: "cta_consistency",
      note: `verbs differ ('${adVerb}' vs '${pageVerb}') but both are conversion verbs`,
    });
    return 50;
  }
  rationale.push({
    subscore: "cta_consistency",
    note: `verbs differ: ad '${adVerb}' vs page '${pageVerb}'`,
  });
  return 25;
}

function extractCtaVerb(texts: string[]): string | null {
  for (const t of texts) {
    const tokens = t.toLowerCase().split(/\s+/);
    for (const tok of tokens) {
      const clean = tok.replace(/[^a-z]/g, "");
      if (COMMON_CTA_VERBS.has(clean)) return clean;
    }
  }
  return null;
}

function scoreOfferClarity(
  inputs: AlignmentScoreInputs,
  rationale: AlignmentScore["rationale"],
): number {
  if (inputs.snapshot.offer_above_fold && inputs.snapshot.cta_above_fold) {
    rationale.push({
      subscore: "offer_clarity",
      note: "offer-shaped phrase detected above fold + CTA above fold",
    });
    return 90;
  }
  if (inputs.snapshot.cta_above_fold) {
    rationale.push({
      subscore: "offer_clarity",
      note: "CTA above fold but offer not detected in head copy",
    });
    return 65;
  }
  if (inputs.snapshot.offer_above_fold) {
    rationale.push({
      subscore: "offer_clarity",
      note: "offer detected above fold but CTA below fold",
    });
    return 50;
  }
  rationale.push({
    subscore: "offer_clarity",
    note: "offer not detected above fold + CTA below fold",
  });
  return 25;
}

function scoreIntentMatch(
  inputs: AlignmentScoreInputs,
  rationale: AlignmentScore["rationale"],
): number {
  const transactionalSignal =
    inputs.snapshot.has_form ||
    (inputs.snapshot.primary_cta?.verb &&
      ["book", "buy", "request", "get", "claim", "schedule", "order"].includes(
        inputs.snapshot.primary_cta.verb,
      ));

  // Search terms hint: words like "how to" / "what is" / "guide" /
  // "vs" lean informational; "near me" / "best" / "buy" / "review"
  // lean transactional. Phase 1 search_terms may be empty.
  let intent: "transactional" | "informational" | "unknown" = "unknown";
  const sample = (inputs.search_terms ?? []).slice(0, 30).join(" ").toLowerCase();
  if (sample) {
    const informational = /(how to|what is|guide|tutorial|examples|vs|comparison)/.test(sample);
    const transactional = /(buy|near me|cheap|cost|price|hire|services|quote)/.test(sample);
    if (informational && !transactional) intent = "informational";
    else if (transactional && !informational) intent = "transactional";
    else if (transactional && informational) intent = "transactional";
  }

  if (intent === "unknown") {
    rationale.push({
      subscore: "intent_match",
      note: "no search-term sample; coarse score",
    });
    return 60;
  }
  if (intent === "transactional" && transactionalSignal) {
    rationale.push({
      subscore: "intent_match",
      note: "transactional intent + transactional page signals",
    });
    return 90;
  }
  if (intent === "informational" && !transactionalSignal) {
    rationale.push({
      subscore: "intent_match",
      note: "informational intent + non-transactional page",
    });
    return 90;
  }
  rationale.push({
    subscore: "intent_match",
    note: `mismatch: ${intent} intent ${transactionalSignal ? "+" : "-"} transactional page`,
  });
  return 35;
}

function fingerprint(inputs: AlignmentScoreInputs): string {
  const parts = [
    inputs.snapshot.h1 ?? "",
    inputs.snapshot.primary_cta?.verb ?? "",
    inputs.keywords
      .slice(0, 5)
      .map((k) => k.text.toLowerCase())
      .join("|"),
    inputs.ad_headlines.slice(0, 3).join("|").toLowerCase(),
  ];
  return cheapHash(parts.join("\n"));
}

function cheapHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) & 0xffffffff;
  }
  return (h >>> 0).toString(16);
}
