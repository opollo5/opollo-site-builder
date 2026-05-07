-- =============================================================================
-- 0105_rls_with_check_clauses.sql
--
-- Adds explicit WITH CHECK clauses to six social-layer RLS policies that were
-- defined with USING only. PostgreSQL uses USING as the effective WITH CHECK
-- when omitted on a FOR ALL policy, so these tables have been secure since
-- 0070. This migration makes the intent explicit and self-documenting for
-- future audits.
--
-- Tables affected:
--   social_approval_recipients, social_approval_events, social_viewer_links,
--   social_schedule_entries, social_publish_attempts, social_webhook_events
-- =============================================================================

-- ── social_approval_recipients ────────────────────────────────────────────────

DROP POLICY IF EXISTS approval_recipients_access ON social_approval_recipients;
CREATE POLICY approval_recipients_access ON social_approval_recipients FOR ALL
  USING (
    is_opollo_staff() OR EXISTS (
      SELECT 1 FROM social_approval_requests r
      WHERE r.id = approval_request_id AND is_company_member(r.company_id)
    )
  )
  WITH CHECK (
    is_opollo_staff() OR EXISTS (
      SELECT 1 FROM social_approval_requests r
      WHERE r.id = approval_request_id AND is_company_member(r.company_id)
    )
  );

-- ── social_approval_events ────────────────────────────────────────────────────

DROP POLICY IF EXISTS approval_events_access ON social_approval_events;
CREATE POLICY approval_events_access ON social_approval_events FOR ALL
  USING (
    is_opollo_staff() OR EXISTS (
      SELECT 1 FROM social_approval_requests r
      WHERE r.id = approval_request_id AND is_company_member(r.company_id)
    )
  )
  WITH CHECK (
    is_opollo_staff() OR EXISTS (
      SELECT 1 FROM social_approval_requests r
      WHERE r.id = approval_request_id AND is_company_member(r.company_id)
    )
  );

-- ── social_viewer_links ───────────────────────────────────────────────────────

DROP POLICY IF EXISTS viewer_links_access ON social_viewer_links;
CREATE POLICY viewer_links_access ON social_viewer_links FOR ALL
  USING (is_opollo_staff() OR is_company_member(company_id))
  WITH CHECK (is_opollo_staff() OR is_company_member(company_id));

-- ── social_schedule_entries ───────────────────────────────────────────────────

DROP POLICY IF EXISTS schedule_entries_access ON social_schedule_entries;
CREATE POLICY schedule_entries_access ON social_schedule_entries FOR ALL
  USING (
    is_opollo_staff() OR EXISTS (
      SELECT 1 FROM social_post_variant v
      JOIN social_post_master m ON m.id = v.post_master_id
      WHERE v.id = post_variant_id AND is_company_member(m.company_id)
    )
  )
  WITH CHECK (
    is_opollo_staff() OR EXISTS (
      SELECT 1 FROM social_post_variant v
      JOIN social_post_master m ON m.id = v.post_master_id
      WHERE v.id = post_variant_id AND is_company_member(m.company_id)
    )
  );

-- ── social_publish_attempts ───────────────────────────────────────────────────

DROP POLICY IF EXISTS publish_attempts_access ON social_publish_attempts;
CREATE POLICY publish_attempts_access ON social_publish_attempts FOR ALL
  USING (
    is_opollo_staff() OR EXISTS (
      SELECT 1 FROM social_publish_jobs j
      WHERE j.id = publish_job_id AND is_company_member(j.company_id)
    )
  )
  WITH CHECK (
    is_opollo_staff() OR EXISTS (
      SELECT 1 FROM social_publish_jobs j
      WHERE j.id = publish_job_id AND is_company_member(j.company_id)
    )
  );

-- ── social_webhook_events ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS webhook_events_staff_only ON social_webhook_events;
CREATE POLICY webhook_events_staff_only ON social_webhook_events FOR ALL
  USING (is_opollo_staff())
  WITH CHECK (is_opollo_staff());
