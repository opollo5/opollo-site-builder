# Admin route audit — 2026-05-07

Static-analysis audit prompted by the admin-shell brief. Walks every
`/admin/*` page route and the `/api/admin/*` endpoints, checks the data
dependency, and flags anything broken in production.

## Methodology

Source-only audit. Could not hit the live env (no prod admin credentials
in this environment). Each row is verified by reading the route file and
its server-side data calls, then cross-referencing the column names
against migrations on disk.

## Root cause that drives most of the breakage

Migrations `0106_sites_last_connection_test_at.sql` and
`0107_user_audit_log_site_actions.sql` (both from PR #732 / Spec 01)
were not applied to production. The `.github/workflows/deploy-migrations.yml`
last successful run was on commit `42dd9c2f` (PR #730); the squash-merges
of PR #731, PR #732, PR #734, PR #735, and PR #736 did not trigger it.

`lib/sites.ts:29 LIGHT_SITE_FIELDS` includes `last_connection_test_at`,
which doesn't exist in prod yet. PostgREST returns
`column "last_connection_test_at" does not exist` → `listSites()` returns
`{ ok:false, error:{code:"INTERNAL_ERROR", message:"Failed to list sites"} }`.

## Page routes

| Route | Data dep | Status | Notes |
|-------|----------|--------|-------|
| `/admin` | redirect → `/admin/sites` | OK | trivial redirect |
| `/admin/sites` | `listSites()` | **BROKEN** | LIGHT_SITE_FIELDS selects `last_connection_test_at` (Issue #2) |
| `/admin/sites/new` | none server-side | OK | client form |
| `/admin/sites/[id]` | `getSite()` (`select *`) + ad-hoc selects on listed columns | OK | `select *` is robust to missing columns; the ad-hoc select at line 164 lists pre-0106 columns only |
| `/admin/sites/[id]/edit` | `getSite()` | OK | |
| `/admin/sites/[id]/settings` | `getSite()` | OK | |
| `/admin/sites/[id]/onboarding` | `getSite()` | OK | |
| `/admin/sites/[id]/setup` | `getSite()` | OK | |
| `/admin/sites/[id]/setup/extract` | `getSite()` | OK | |
| `/admin/sites/[id]/appearance` | `getSite()` | OK | |
| `/admin/sites/[id]/pages` | `getSite()` | OK | |
| `/admin/sites/[id]/pages/[pageId]` | per-page select | OK | `pages` table not affected |
| `/admin/sites/[id]/posts` | `getSite()` + `listPostsForSite()` | OK | `posts` table not affected |
| `/admin/sites/[id]/posts/new` | `getSite()` | OK | |
| `/admin/sites/[id]/posts/[post_id]` | per-post select | OK | |
| `/admin/sites/[id]/briefs/[brief_id]/run` | `getSite()` + briefs select | OK | |
| `/admin/sites/[id]/briefs/[brief_id]/review` | `getSite()` + briefs select | OK | |
| `/admin/sites/[id]/blueprints/review` | client fetch | OK | hits `/api/sites/[id]/blueprints` |
| `/admin/sites/[id]/content` | client fetch | OK | hits `/api/sites/[id]/shared-content` |
| `/admin/sites/[id]/design-system` | `design_systems` select | OK | |
| `/admin/sites/[id]/design-system/components` | `design_templates` select | OK | |
| `/admin/sites/[id]/design-system/templates` | `design_templates` select | OK | |
| `/admin/sites/[id]/design-system/preview` | renders only | OK | |
| `/admin/posts/new` | `listSites()` | **BROKEN** | same root cause as `/admin/sites` (Issue #3) |
| `/admin/batches` | `generation_jobs` select | OK | not affected |
| `/admin/batches/[id]` | per-job select | OK | |
| `/admin/images` | `image_library` select via `/api/admin/images/list` | OK | |
| `/admin/images/[id]` | per-image select | OK | |
| `/admin/users` | `opollo_users` select | OK | |
| `/admin/users/audit` | `user_audit_log` select | OK at read-time | `0107` only loosens the action CHECK + drops NOT NULL on `target_email`; existing reads keep working pre-migration |
| `/admin/companies` | `platform_companies` select | OK | |
| `/admin/companies/new` | client form | OK | |
| `/admin/companies/[id]` | `platform_companies` + `opollo_users` | OK | |
| `/admin/system/jobs` | `generation_jobs` select | OK | |
| `/admin/email-test` | none server-side | OK | client form |
| `/admin/settings` | `design_system_settings` select | OK | |
| `/admin/settings/design-system` | `design_system_settings` select | OK | |

## API endpoints (admin-only or admin-callable)

| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /api/sites/list` | **BROKEN (write-side dep)** | calls `listSites()` underneath |
| `POST /api/sites/[id]/test-connection` | **PARTIALLY BROKEN** | tries to UPDATE `last_connection_test_at = now()` (lib/sites.ts:966). UPDATE on a missing column fails. |
| `DELETE /api/sites/[id]/purge` | **BROKEN if invoked** | inserts `action='site_purged'` into `user_audit_log` — CHECK constraint blocks pre-0107. Super-admin only, so unlikely surfaced. |
| `GET /api/admin/users/list` | OK | unaffected schema |
| `GET /api/admin/images/list` | OK | unaffected schema |
| `POST /api/platform/invitations` | OK | unaffected schema |
| `GET /api/platform/companies/list` | OK | unaffected schema |
| Other `/api/sites/[id]/*` (settings, blueprints, content, etc.) | OK | use getSite or per-id selects, all robust |

## Summary

- **Blocking failures in prod**: `/admin/sites`, `/admin/posts/new`,
  `POST /api/sites/[id]/test-connection`, and (latent)
  `DELETE /api/sites/[id]/purge`. All four are the same root cause —
  missing migrations 0106 + 0107 in production.
- **Single fix**: apply the two pending migrations via
  `.github/workflows/deploy-migrations.yml` (workflow_dispatch on the
  GitHub Actions UI, or a `gh workflow run deploy-migrations.yml --ref main`
  from a local with credentials).
- **Code is already correct on `main`** — no code change needed in PR A.
- **No other admin routes are broken** in static analysis. If the user
  surfaces additional issues from the live env, those go in a follow-up.

## Why deploy-migrations didn't auto-trigger

Confirmed gap: `gh run list --workflow deploy-migrations.yml --limit 20`
shows the last successful run was on commit `42dd9c2f` (PR #730).
PR #731 (commit `1d07ecfa`), PR #732 (`a6819e42`), PR #734 (`022a3ea1`),
PR #735 (`9fcf1336`), PR #736 (`9c955cde`) all merged on `main` AFTER
that. PR #732 modified `supabase/migrations/0106*.sql` and `0107*.sql`,
which match the workflow's `paths` filter, but no run fired.

Most likely cause: the workflow's `environment: production` gate has a
required-reviewer rule that's silently dropping the auto-trigger queue
without surfacing a "waiting for approval" run in the UI. (No
`status=waiting` runs were found via `gh run list --status waiting`.)

A separate follow-up should investigate why the queue isn't surfacing.
For now, the recovery procedure documented in `docs/RUNBOOK.md`
§"Apply pending migrations to production" is the right path:
`workflow_dispatch` the deploy job (or run `supabase db push --linked
--include-all` against the prod DB URL).
