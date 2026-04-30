-- Rollback for 0058_invite_audit_functions.sql.

DROP FUNCTION IF EXISTS public.accept_invite(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.revoke_invite(uuid, uuid);
DROP FUNCTION IF EXISTS public.create_invite(text, text, uuid, text, timestamptz);
