# Proofing / Workflow / Client-Portal — Durable Principles

Moved from `CLAUDE.md` to keep that file under 450 lines. Every rule here has
the same force as if it were in CLAUDE.md. The summary in
§"Proofing / Workflow / Client-Portal" is the pointer; this file is the canonical
reference.

Derived from the B1–B3 build (2026-06-02/03). Every agent working on the
proofing/approval/workflow subsystem (magic links, proof lifecycle, workflow
engine, client portal) MUST apply these without exception.

---

## Production database is never a test environment

**Highest-priority rule in this section.**

- Verification scripts, seeding scripts, and integration tests NEVER use
  production credentials (`SUPABASE_URL` pointing to the prod project,
  `SUPABASE_SERVICE_ROLE_KEY` for prod). If local Supabase/Docker is
  unavailable, **STOP and tell Steven. Do not fall back to prod creds under any
  condition.**
- No test or seed data is ever written to the production database. The V2
  publish-due cron (`claimDueDrafts`) has no company-level guard; any
  `state=scheduled` draft in any company — including one created by a
  verification script — enters the live publish path on the next cron tick.
- If Docker is not running and `supabase start` fails, the correct response is:
  "Local Supabase unavailable. Please start Docker." Not: fall back to prod. Not:
  run a subset of checks. Stop.

## Recon-first, stub-first

Before writing any migration: grep for existing schema stubs
(`platform_session_grants`, OTP columns, relevant partial indexes). Find the
correct existing home before adding new tables. The failure mode is creating a
parallel table that duplicates an existing stub.

Before designing any fix: find the working analog in the codebase
(`docs/patterns/WORKING_ANALOG.md`). The proofing/approval backbone has many
subtly connected tables (`social_approval_requests`, `_recipients`, `_events`,
`record_approval_decision` RPC) and wrong assumptions compound across migrations.

## Architecture invariants

- **Magic links are core infra.** B1's `magic_links` table is the single token
  primitive for approval, login, and reconnect. Do not create a second token
  system. Do not add a new purpose without extending the `purpose` CHECK.
- **V2, not V1.** All new proofing, approval, and scheduling work targets
  `social_post_drafts` (V2 pipeline). `social_post_master` (V1) is retiring. When
  `post_master_id IS NULL`, skip V1 lookups entirely — do not error, do not fall
  back, return `null` for the V1-specific field and let the caller handle it.
- **Company-context is always explicit.** Every company-scoped action must resolve
  and enforce the correct company. Never use ambient company context. Verify with
  `is_company_member(company_id)` / `is_opollo_staff()` at every RLS boundary.
  Opollo users switch context; customers are hard-walled. A path that admits a
  customer to another company's data is a P0 security bug.
- **`content_group_id` is explicit-only.** No DEFAULT after backfill. Every insert
  into `social_post_drafts` must name it. Omitting it produces a loud NOT NULL
  violation — that is the intended behaviour.

## Hard stops — show Steven before running, do NOT auto-merge

Stop and show the migration shape + strategy before executing any of:

1. **Any migration touching a live in-prod flow** — approval requests, decision
   RPC, approval recipients, magic_links, or the image-review gate path.
   Migrations 0172–0176 are the reference; every subsequent migration in this
   subsystem requires the same pre-flight review.
2. **Destructive ALTER or data-loss** — `DROP COLUMN`, `ALTER COLUMN` that changes
   type or removes NOT NULL, `DROP TABLE`, `TRUNCATE`.
3. **RLS boundary changes** — adding or modifying RLS policies on any table that
   holds company-scoped data.
4. **Cross-tenant connection access** — anything touching `social_connections`,
   OAuth callback paths, or `external_identity_hash` cross-tenant binding. The
   LinkedIn cross-tenant leak (2026-05-11) is the incident to not repeat.
5. **The gate→step bridge** — already ran (migration 0176). If any future
   migration touches `company_workflow_gates` with a write (UPDATE, DELETE,
   ALTER), treat it as a hard stop.

**Hard-stop PRs must NOT be armed for auto-merge (`gh pr merge --auto`). They
require an explicit human merge by Steven after review. "Show Steven before
running" is void if CI-green auto-merge lands it past him — which already
happened with the 0176 bridge.** Wait for Steven to run
`gh pr merge <PR> --squash` manually.

These are in addition to, not replacing, the §"Hard stops" list in `CLAUDE.md`.

## Known hazard — `claimDueDrafts` has no company-level guard

The V2 publish-due cron queries `WHERE state='scheduled' AND scheduled_at <=
now() AND archived_at IS NULL` with no company-level filter. Any draft matching
those conditions — in any company — enters the live publish path.

**B4 scope protection:** B4 is reconnect + approval only. B4 must have NO write
path that sets `social_post_drafts.state='scheduled'`. If B4 never produces a
scheduled draft, the cron exposure is moot for B4. Any B4 code that touches
draft state must be audited to confirm it cannot reach `state='scheduled'`. Fix
vs accept decision deferred to Steven; tracked at
`docs/backlog/cron-guard-missing.md`.
