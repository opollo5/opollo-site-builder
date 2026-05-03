-- S1-53 — persist reviewer comment on request-changes.
--
-- Stores the latest reviewer note on the post row so the editor can see
-- what needs fixing without relying solely on the notification email.
-- Cleared on reopen-for-editing so a stale comment from a prior cycle
-- doesn't persist across resubmissions.
--
-- Column is nullable; NULL means no comment was provided (or the post
-- was never in changes_requested).
ALTER TABLE social_post_master
  ADD COLUMN IF NOT EXISTS reviewer_comment TEXT;
