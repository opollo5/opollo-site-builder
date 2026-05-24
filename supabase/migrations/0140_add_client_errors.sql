-- Migration: 0140_add_client_errors.sql
-- Adds the client_errors table for structured client-side error logging.
-- Every AI generation failure (and later all composer errors) records here
-- so support can correlate user-visible trace_ids with server context.
--
-- Schema matches wireframe State 13 exactly.
-- No RLS needed: inserted via service role from POST /api/errors (auth-gated).

create table if not exists client_errors (
  id          uuid         primary key default gen_random_uuid(),
  trace_id    text         not null,
  company_id  uuid         references platform_companies(id),
  user_id     uuid         references auth.users(id),
  surface     text         not null,
  error_code  text         not null,
  http_status int,
  severity    text         not null check (severity in ('critical', 'error', 'warning', 'info')),
  message     text,
  context     jsonb,
  stack       text,
  user_agent  text,
  created_at  timestamptz  default now()
);

create index if not exists idx_client_errors_company_created
  on client_errors (company_id, created_at desc);

create index if not exists idx_client_errors_severity
  on client_errors (severity, created_at desc);
