-- Rollback for 0071_submit_post_for_approval_fn.sql
DROP FUNCTION IF EXISTS submit_post_for_approval(UUID, UUID, JSONB, TIMESTAMPTZ);
