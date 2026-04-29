-- 0039 — Optimiser: opt_alignment_scores.
-- Reference: spec §8 (alignment scoring), §5.1.
--
-- Most-recent alignment score per (ad_group, landing_page) pair.
-- Recomputed every weekly sync; previous score overwritten in place.
-- No history table: the impact-of-changes question is answered by
-- opt_change_log + opt_proposals timeline, not by every weekly score.

CREATE TABLE opt_alignment_scores (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                uuid NOT NULL
    REFERENCES opt_clients(id) ON DELETE CASCADE,
  ad_group_id              uuid NOT NULL
    REFERENCES opt_ad_groups(id) ON DELETE CASCADE,
  landing_page_id          uuid NOT NULL
    REFERENCES opt_landing_pages(id) ON DELETE CASCADE,

  -- Composite 0–100. Per §8.1 = weighted blend of the five sub-scores.
  score                    integer NOT NULL
    CHECK (score >= 0 AND score <= 100),

  -- Five sub-scores per §8.1 / Table 17. Each 0–100.
  keyword_relevance        integer NOT NULL
    CHECK (keyword_relevance >= 0 AND keyword_relevance <= 100),
  ad_to_page_match         integer NOT NULL
    CHECK (ad_to_page_match >= 0 AND ad_to_page_match <= 100),
  cta_consistency          integer NOT NULL
    CHECK (cta_consistency >= 0 AND cta_consistency <= 100),
  offer_clarity            integer NOT NULL
    CHECK (offer_clarity >= 0 AND offer_clarity <= 100),
  intent_match             integer NOT NULL
    CHECK (intent_match >= 0 AND intent_match <= 100),

  -- Verbatim LLM critique + rule-trace. Surfaces in the proposal review
  -- "why" pane so staff can audit how a score was reached.
  rationale                jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Snapshot of input fingerprints — keyword set hash, ad headlines hash,
  -- page snapshot hash. Used by the cache layer (§4.6) to skip recompute
  -- when nothing has changed.
  input_fingerprint        text,

  computed_at              timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX opt_alignment_scores_pair_uniq
  ON opt_alignment_scores (ad_group_id, landing_page_id);

CREATE INDEX opt_alignment_scores_page_idx
  ON opt_alignment_scores (landing_page_id, score DESC);

ALTER TABLE opt_alignment_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON opt_alignment_scores
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY opt_alignment_scores_read ON opt_alignment_scores
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));
