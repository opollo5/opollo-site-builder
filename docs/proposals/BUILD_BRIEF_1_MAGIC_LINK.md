# Build Brief 1/3 — Magic Link Infrastructure

CONTRACT-DRIVEN AUTONOMOUS BUILD. First of three (Magic Link → Core Proofing V1 →
Workflow Engine). Build this FIRST — the other two depend on it. Execute end-to-end, one
PR per logical change, migration-first, report at the end. Grounded in
`docs/recon/PROOFING_RECON.md`.

> START WITH RECON: before writing code, re-read docs/recon/PROOFING_RECON.md and verify
> the assumptions below against the current codebase. Report any drift before building.

---

## Why this is first

Magic links are core platform infrastructure (login, content approvals, social-connection
reconnect, reviewer access). The proofing system can't notify or admit external reviewers
without it. Recon finding 5: the raw token is SHA-256 hashed at creation and discarded —
there is NO way to recover or resend a link today; resend needs a fresh token. This brief
builds a general, reusable magic-link service that owns the full token lifecycle.

## Locked context (from recon — verify, don't assume)

- Token generation today: `lib/platform/invitations/tokens.ts` — `generateRawToken()` →
  64-char hex; only SHA-256 hash stored. Reuse this primitive; do not reinvent hashing.
- `social_approval_recipients` holds approval tokens: `token_hash`, `platform_user_id`
  (null = external), `external_email`, `requires_otp`, `otp_code_hash`, `otp_expires_at`
  (OTP columns present, entirely unwired — finding 6), `revoked_at`.
- External `/approve/[token]` auth: token-only identity, no account, no OTP.
- Email: `dispatch()` + SendGrid, templates registered in `lib/email/templates/`,
  `platform_email_log` + `is_critical` admin-alert path, QStash enqueue w/ dedup.
- No magic-link reconnect path exists (finding 7) — greenfield.
- No passwordless magic-login path confirmed — treat login use as additive.

## Goal

A general `lib/platform/magic-link/` service: issue, store, validate, consume, revoke,
and **re-send/regenerate** links for ANY purpose, identified by a `purpose` discriminator.
Approvals become its first consumer; login + reconnect are additive consumers.

## Step 1 — Migration (migration-first; apply + verify in prod before code)

New table `magic_links` (the general service — does NOT replace approval recipients, sits
alongside; approval recipients become a consumer that references a magic link):
```
id            uuid pk default gen_random_uuid()
purpose       text not null check (purpose in ('approval','login','reconnect'))
token_hash    text not null            -- SHA-256, reuse existing primitive
subject_type  text                      -- e.g. 'approval_recipient','user','social_connection'
subject_id    uuid                      -- the row this link acts on
company_id    uuid references platform_companies(id) on delete cascade
email         text                      -- recipient
expires_at    timestamptz not null
consumed_at   timestamptz               -- one-time-use marker (null = unused)
revoked_at    timestamptz
regenerated_from uuid references magic_links(id)  -- chain when resent
created_at    timestamptz not null default now()
unique (token_hash)
index on (subject_type, subject_id) where revoked_at is null and consumed_at is null
```
RLS: `is_opollo_staff() OR is_company_member(company_id)`; service-role for validate/consume.

## Step 2 — The service (`lib/platform/magic-link/`)

- `issue({purpose, subjectType, subjectId, companyId, email, ttl})` → returns the RAW
  token ONCE (caller sends it in the email) + the row. Stores hash only.
- `validate(rawToken)` → `{valid, link}`; rejects if revoked/consumed/expired.
- `consume(rawToken)` → atomically sets `consumed_at` if one-time-use for that purpose;
  idempotent. (Approval links: one-time per Gain's model — issue a fresh one on each send.)
- `revoke(linkId | subjectRef)` → sets `revoked_at`; used by batch-delete + resend.
- `regenerate(linkId)` → revokes old, issues new with `regenerated_from` set, returns raw
  token. THIS is the resend primitive finding 5 said is missing.
- Configurable TTL per purpose (approval default: Gain-style — one-time or 24h, whichever
  first; login/reconnect their own).

## Step 3 — Wire approvals as the first consumer

- Refactor approval-recipient token creation to issue via the magic-link service
  (`purpose='approval'`, `subjectType='approval_recipient'`, `subjectId=recipient.id`).
  Keep `social_approval_recipients.token_hash` working (back-compat) OR point it at the
  magic_links row — choose the lower-risk path and state which; do not break the live
  `/approve/[token]` flow.
- Provide `regenerateApprovalLink(recipientId)` so Phase-2 external reminders (currently
  skipped, finding) can send a fresh working link.
- The `/approve/[token]` route validates + consumes via the service.

## Step 4 — Login + reconnect consumers (additive, minimal)

- `purpose='login'`: a passwordless email-login link issuance + a route that validates,
  consumes, and establishes the session. (Mirror existing session establishment.)
- `purpose='reconnect'`: issue a link that lands an operator/client on the social-
  connection reconnect OAuth start for a specific connection (greenfield, finding 7).
- Keep these minimal — the point is the service supports them, not a full UX build.

## Step 5 — Tests + verify
Issue/validate/consume/revoke/regenerate; one-time-use enforcement; expiry; revoke cascade;
approval link still admits at `/approve/[token]`; regenerate produces a working new link
and invalidates the old. Typecheck/lint/suite green. L18 Definition of Done.

## Constraints
Reuse the existing hashing primitive + dispatch() + QStash. One engine, generic by
`purpose`. Transactional, idempotent, preserve audit, RLS, mirror route conventions
(`app/api/platform/image/jobs/[id]/select/route.ts` is the canonical shape). No second
token system.

## Report
PRs, migration prod-verified, what Steven verifies live (resend a link, log in via link),
and any drift from the recon assumptions (feeds briefs 2 + 3).
