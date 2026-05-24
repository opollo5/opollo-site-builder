-- Migration: 0141_client_errors_resolved_at.sql
-- Adds resolved_at to client_errors for the admin triage workflow.
-- NULL = unresolved, NOT NULL = resolved by an operator.

alter table client_errors
  add column if not exists resolved_at timestamptz default null;

create index if not exists idx_client_errors_unresolved
  on client_errors (created_at desc)
  where resolved_at is null;
