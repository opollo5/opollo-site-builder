-- Rollback for 0072_record_approval_decision_fn.sql
DROP FUNCTION IF EXISTS record_approval_decision(UUID, social_approval_event_type, TEXT, INET, TEXT);
