-- 0179_feedback_tracker.sql
-- In-App Feedback, Ticketing & Issue-Triage — v1 foundation.
-- Creates feedback_tickets, feedback_ticket_comments, feedback_ticket_events
-- tables plus RLS policies. Extends platform_notification_type enum with
-- five feedback events. Creates the feedback-screenshots storage bucket.
--
-- Auth helpers used in RLS policies:
--   is_opollo_staff()         — defined in 0070_platform_foundation.sql
--   is_company_member(uuid)   — defined in 0070_platform_foundation.sql
-- These are the correct helpers for company-scoped customer data (not auth_role()).

-- ---------------------------------------------------------------------------
-- Extend the notification type enum (forward-only; IF NOT EXISTS prevents
-- replay failures on subsequent applies).
-- ---------------------------------------------------------------------------
ALTER TYPE platform_notification_type ADD VALUE IF NOT EXISTS 'ticket_created';
ALTER TYPE platform_notification_type ADD VALUE IF NOT EXISTS 'ticket_assigned';
ALTER TYPE platform_notification_type ADD VALUE IF NOT EXISTS 'ticket_comment_added';
ALTER TYPE platform_notification_type ADD VALUE IF NOT EXISTS 'ticket_status_changed';
ALTER TYPE platform_notification_type ADD VALUE IF NOT EXISTS 'ticket_reopened_by_customer';

-- ---------------------------------------------------------------------------
-- feedback_tickets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback_tickets (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES platform_companies(id),
  title               text        NOT NULL,
  description         text        NOT NULL CHECK (char_length(description) <= 2000),
  severity            text        NOT NULL DEFAULT 'normal'
                                    CHECK (severity IN ('low','normal','high','blocker')),
  priority            text        NOT NULL DEFAULT 'medium'
                                    CHECK (priority IN ('low','medium','high','urgent')),
  status              text        NOT NULL DEFAULT 'backlog'
                                    CHECK (status IN ('backlog','triaged','in_progress','fixed',
                                                      'verified','wont_fix','closed')),
  assignee_id         uuid        REFERENCES platform_users(id),
  triaged_by          uuid        REFERENCES platform_users(id),
  triaged_at          timestamptz,
  verified_by         uuid        REFERENCES platform_users(id),
  verified_at         timestamptz,
  tags                text[]      NOT NULL DEFAULT '{}',
  page_url            text        NOT NULL,
  route_pattern       text,
  css_selector        text        NOT NULL,
  element_label       text,
  click_x_pct         numeric     NOT NULL CHECK (click_x_pct BETWEEN 0 AND 100),
  click_y_pct         numeric     NOT NULL CHECK (click_y_pct BETWEEN 0 AND 100),
  viewport_w          integer     NOT NULL,
  viewport_h          integer     NOT NULL,
  device_pixel_ratio  numeric,
  user_agent          text,
  console_errors      jsonb,
  screenshot_path     text,
  annotation          jsonb,
  repo_ref            text,
  linked_pr_url       text,
  created_by          uuid        NOT NULL REFERENCES platform_users(id),
  updated_by          uuid        REFERENCES platform_users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  deleted_by          uuid        REFERENCES platform_users(id)
);

CREATE INDEX IF NOT EXISTS feedback_tickets_company_idx
  ON feedback_tickets (company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS feedback_tickets_status_idx
  ON feedback_tickets (status)     WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS feedback_tickets_assignee_idx
  ON feedback_tickets (assignee_id);

-- Reuse the shared updated_at trigger function (defined in 0070); one
-- trigger per table, named consistently.
CREATE OR REPLACE TRIGGER feedback_tickets_updated_at
  BEFORE UPDATE ON feedback_tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE feedback_tickets ENABLE ROW LEVEL SECURITY;

-- Service role: full access (for bugs:push + signed uploads)
CREATE POLICY feedback_tickets_service ON feedback_tickets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Read: staff see all; members see their company; soft-deleted rows are staff-only
CREATE POLICY feedback_tickets_read ON feedback_tickets FOR SELECT USING (
  (deleted_at IS NULL AND (is_opollo_staff() OR is_company_member(company_id)))
  OR (deleted_at IS NOT NULL AND is_opollo_staff())
);

-- Insert: any company member or Opollo staff
CREATE POLICY feedback_tickets_insert ON feedback_tickets FOR INSERT WITH CHECK (
  is_opollo_staff() OR is_company_member(company_id)
);

-- Update: Opollo staff only. The controlled customer reopen (§4) runs via
-- the service-role path in update-status.ts after validating membership —
-- it does NOT widen this policy.
CREATE POLICY feedback_tickets_update ON feedback_tickets FOR UPDATE USING (
  is_opollo_staff()
);

-- ---------------------------------------------------------------------------
-- feedback_ticket_comments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback_ticket_comments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid        NOT NULL REFERENCES feedback_tickets(id) ON DELETE CASCADE,
  body        text        NOT NULL,
  author_id   uuid        NOT NULL REFERENCES platform_users(id),
  is_staff    boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  deleted_by  uuid        REFERENCES platform_users(id)
);

CREATE INDEX IF NOT EXISTS feedback_ticket_comments_ticket_idx
  ON feedback_ticket_comments (ticket_id) WHERE deleted_at IS NULL;

CREATE OR REPLACE TRIGGER feedback_ticket_comments_updated_at
  BEFORE UPDATE ON feedback_ticket_comments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE feedback_ticket_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY feedback_comments_service ON feedback_ticket_comments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY feedback_comments_read ON feedback_ticket_comments FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM feedback_tickets t
    WHERE t.id = ticket_id
      AND (is_opollo_staff() OR is_company_member(t.company_id))
  )
);

CREATE POLICY feedback_comments_insert ON feedback_ticket_comments FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM feedback_tickets t
    WHERE t.id = ticket_id
      AND (is_opollo_staff() OR is_company_member(t.company_id))
  )
);

-- ---------------------------------------------------------------------------
-- feedback_ticket_events (append-only audit trail)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback_ticket_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid        NOT NULL REFERENCES feedback_tickets(id) ON DELETE CASCADE,
  event_type  text        NOT NULL
                            CHECK (event_type IN ('created','assigned','reassigned',
                                   'status_changed','severity_changed','priority_changed',
                                   'reopened_by_customer','verified','closed')),
  from_value  text,
  to_value    text,
  actor_id    uuid        REFERENCES platform_users(id),
  actor_kind  text        NOT NULL DEFAULT 'human-staff'
                            CHECK (actor_kind IN ('human-staff','automation','customer-reporter','system')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_ticket_events_ticket_idx
  ON feedback_ticket_events (ticket_id, created_at);

ALTER TABLE feedback_ticket_events ENABLE ROW LEVEL SECURITY;

-- Events are written server-side (service role) only — authenticated clients
-- get read access via the parent ticket's visibility; no client insert/update/delete.
CREATE POLICY feedback_events_service ON feedback_ticket_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY feedback_events_read ON feedback_ticket_events FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM feedback_tickets t
    WHERE t.id = ticket_id
      AND (is_opollo_staff() OR is_company_member(t.company_id))
  )
);

-- ---------------------------------------------------------------------------
-- Storage bucket: feedback-screenshots (private; sign on read)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('feedback-screenshots', 'feedback-screenshots', false)
ON CONFLICT (id) DO NOTHING;

-- Service role can read/write; authenticated users can insert (upload via
-- signed URL) but not read directly — reads always go through the signed-URL
-- endpoint. The bucket is private so anonymous reads return 403.
CREATE POLICY feedback_screenshots_service ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'feedback-screenshots')
  WITH CHECK (bucket_id = 'feedback-screenshots');

CREATE POLICY feedback_screenshots_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'feedback-screenshots');
