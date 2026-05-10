-- Migration 0115: error_reports table
--
-- Stores every submitted error report. Backend persists first, then sends
-- mail. If mail fails the row remains and can be retried or queried.

CREATE TABLE IF NOT EXISTS error_reports (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  payload      jsonb       NOT NULL,
  mail_status  text        NOT NULL DEFAULT 'pending'
                           CHECK (mail_status IN ('pending', 'sent', 'failed')),
  mail_error   text,
  mail_sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS error_reports_user_id_idx   ON error_reports (user_id);
CREATE INDEX IF NOT EXISTS error_reports_created_at_idx ON error_reports (created_at DESC);

-- RLS
ALTER TABLE error_reports ENABLE ROW LEVEL SECURITY;

-- Any authenticated user may insert their own report.
CREATE POLICY "error_reports_insert_own"
  ON error_reports FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Only super_admins may read all reports.
CREATE POLICY "error_reports_select_super_admin"
  ON error_reports FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM opollo_users u
      WHERE u.id = auth.uid()
        AND u.role = 'super_admin'
    )
  );

-- No client-side UPDATE or DELETE.
