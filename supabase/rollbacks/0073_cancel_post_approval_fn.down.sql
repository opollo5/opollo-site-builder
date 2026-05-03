-- Rollback for 0073_cancel_post_approval_fn.sql
DROP FUNCTION IF EXISTS cancel_post_approval(UUID, UUID, UUID, TEXT);
