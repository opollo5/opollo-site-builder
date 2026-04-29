-- 0041 — Optimiser: opt_proposals.
-- Reference: spec §9.1 (anatomy), §9.2 (risk), §9.4 (priority + confidence),
-- §9.7 (expiry), §9.6.3 (technical_alert category).
--
-- Design decisions encoded here:
--
-- 1. status state machine: draft → pending → approved → applied →
--    applied_promoted | applied_then_reverted; pending → rejected;
--    pending → expired. CHECK enumerates the legal states; a
--    progress-only invariant is enforced by application code (no
--    trigger — see CLAUDE.md no-trigger-deadlock rule).
--
-- 2. category = 'content_fix' | 'technical_alert'. Technical alerts
--    are non-approvable per §9.6.3: priority_score is forced 0 and
--    expiry is NULL. Content fixes carry the full proposal payload.
--
-- 3. expires_at: 14 days from creation by default per §9.7. Slice 5
--    enforces the API-level rejection of approve-after-expiry.
--
-- 4. Confidence sub-factors stored alongside the composite for
--    transparency in the review pane (§9.4.1 worked example).
--
-- 5. change_set + before_snapshot + after_snapshot are JSONB. The
--    Site Builder's existing review components consume this shape
--    (§3.5.3 brief construction).

CREATE TABLE opt_proposals (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                 uuid NOT NULL
    REFERENCES opt_clients(id) ON DELETE CASCADE,
  landing_page_id           uuid NOT NULL
    REFERENCES opt_landing_pages(id) ON DELETE CASCADE,
  ad_group_id               uuid REFERENCES opt_ad_groups(id) ON DELETE SET NULL,
  triggering_playbook_id    text REFERENCES opt_playbooks(id) ON DELETE SET NULL,

  category                  text NOT NULL DEFAULT 'content_fix'
    CHECK (category IN ('content_fix', 'technical_alert')),

  status                    text NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'draft',
      'pending',
      'approved',
      'applied',
      'applied_promoted',
      'applied_then_reverted',
      'rejected',
      'expired'
    )),

  -- Headline shown on the proposal list row; full detail in change_set.
  headline                  text NOT NULL,
  problem_summary           text,

  risk_level                text NOT NULL DEFAULT 'medium'
    CHECK (risk_level IN ('low', 'medium', 'high')),

  -- Priority maths: impact * confidence / effort. Stored so the list
  -- view can sort with one indexed column rather than recompute on
  -- every page render.
  priority_score            numeric(8, 3) NOT NULL DEFAULT 0,
  impact_score              numeric(6, 2) NOT NULL DEFAULT 0
    CHECK (impact_score >= 0 AND impact_score <= 100),
  effort_bucket             integer NOT NULL DEFAULT 1
    CHECK (effort_bucket IN (1, 2, 4)),

  confidence_score          numeric(4, 3) NOT NULL DEFAULT 0
    CHECK (confidence_score >= 0 AND confidence_score <= 1),
  confidence_sample         numeric(4, 3),
  confidence_freshness      numeric(4, 3),
  confidence_stability      numeric(4, 3),
  confidence_signal         numeric(4, 3),

  -- Expected impact range — surfaced as "+0.4% to +1.2% CR" rather
  -- than a point estimate.
  expected_impact_min_pp    numeric(6, 3),
  expected_impact_max_pp    numeric(6, 3),

  -- Structured payload. change_set is the list of section-level diffs
  -- (Site Builder brief shape); before/after_snapshot is a render-ready
  -- payload for the review pane preview.
  change_set                jsonb NOT NULL DEFAULT '{}'::jsonb,
  before_snapshot           jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_snapshot            jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Snapshot of current performance at proposal creation. Frozen so
  -- the review pane shows what the engine saw, not what's true now.
  current_performance       jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Free-form rejection reason captured into per-client memory
  -- (§11.1). Standard set surfaces in the UI ("not aligned with brand"
  -- / "offer change not approved" / "bad timing" / "design conflict")
  -- plus a free-text fallback. NULL for non-rejected.
  rejection_reason_code     text,
  rejection_reason_text     text,

  -- Free-form pre-build reprompt (§9.10.1). Appended to the brief on
  -- approve.
  pre_build_reprompt        text,

  -- Site Builder brief id (Phase 1.5). NULL until the brief is submitted.
  submitted_brief_id        uuid,

  expires_at                timestamptz,
  approved_at               timestamptz,
  approved_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rejected_at               timestamptz,
  rejected_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  applied_at                timestamptz,

  version_lock              bigint NOT NULL DEFAULT 1
    CHECK (version_lock >= 1),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at                timestamptz
);

CREATE INDEX opt_proposals_client_status_priority_idx
  ON opt_proposals (client_id, status, priority_score DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX opt_proposals_landing_page_idx
  ON opt_proposals (landing_page_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX opt_proposals_expires_at_idx
  ON opt_proposals (expires_at)
  WHERE deleted_at IS NULL
    AND expires_at IS NOT NULL
    AND status IN ('pending', 'approved');

ALTER TABLE opt_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON opt_proposals
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY opt_proposals_read ON opt_proposals
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));

CREATE POLICY opt_proposals_write ON opt_proposals
  FOR ALL TO authenticated
  USING      (public.auth_role() IN ('admin', 'operator'))
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));
