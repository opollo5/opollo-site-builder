# Staging Environment — Current State Investigation

**Date:** 2026-05-24  
**Branch investigated:** `fix/composer-central-image-library` (current); findings are codebase-wide  
**Method:** Read-only. No changes made.

---

## 1. Vercel Environments

**Project identity (`.vercel/project.json`):**

```json
{
  "projectId": "prj_lLcYeRecxsczxuKVznHxgxDHq3ZX",
  "orgId": "team_2uUn8opDTzBmL6wJu3Fc8FAN",
  "projectName": "opollo-site-builder"
}
```

**Vercel CLI status:** `vercel` binary not found in PATH on this machine. Cannot run `vercel ls` or `vercel env ls` directly. All findings below derive from local files, docs, and git history.

**Configured environments (inferred from `docs/exports/auth-decisions.md` env var scope column and `lib/runtime-env.ts:1-13`):**

| Vercel environment | Scope label in codebase | `VERCEL_ENV` value |
|---|---|---|
| Production | `production` | `production` |
| Preview | `preview` (also reused for `staging` — see below) | `preview` |
| Development | `development` | unset (localhost) |

**Custom "staging" environment?** No dedicated Vercel environment named "staging" exists. Instead, the `staging` Git branch is a regular Vercel Preview deployment with two additional env var overrides:

- `APP_ENV=staging` — causes `lib/runtime-env.ts:getRuntimeEnv()` to return `"staging"` instead of `"preview"`
- `STAGING_EMAIL_RECIPIENT=hi@opollo.com`

Source: `docs/briefs/hardening-pass/STEVEN_ACTIONS.md:13` (confirmed set 2026-05-20).

**Stable persistent staging URL?** NOT FOUND. No custom domain like `staging.opollo.com` is documented anywhere. The `staging` branch gets an ephemeral Vercel preview URL per deployment. There is no pinned persistent URL for staging in any config, doc, or env file.

**Production URL (from `smoke.yml:27`):** `https://opollo-site-builder.vercel.app`

---

## 2. Vercel Environment Variables

Vercel CLI is unavailable, so this is derived from `docs/exports/auth-decisions.md` (the canonical env var table) and confirmed against local `.env.*` files.

**Variables scoped to Production + Preview + Development (all three — same values):**

| Variable | Source evidence |
|---|---|
| `SUPABASE_URL` | `docs/exports/auth-decisions.md:51` — scope: "Production, Preview, Development" |
| `SUPABASE_ANON_KEY` | `docs/exports/auth-decisions.md:52` — scope: "Production, Preview, Development" |
| `SUPABASE_SERVICE_ROLE_KEY` | `docs/exports/auth-decisions.md:53` — scope: "Production, Preview, Development" |
| `NEXT_PUBLIC_SUPABASE_URL` | `docs/exports/auth-decisions.md:54` — scope: "All" |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `docs/exports/auth-decisions.md:55` — scope: "All" |
| `SUPABASE_DB_URL` | `docs/exports/auth-decisions.md:60` — scope: "Production, Preview, Development" |

**Staging-specific variables (set only for `staging` branch Preview deployments):**

| Variable | Value | Set date | Source |
|---|---|---|---|
| `APP_ENV` | `staging` | 2026-05-20 | `docs/briefs/hardening-pass/STEVEN_ACTIONS.md:13` |
| `STAGING_EMAIL_RECIPIENT` | `hi@opollo.com` | 2026-05-20 | `docs/briefs/hardening-pass/STEVEN_ACTIONS.md:13` |

**`STAGING_SIDE_EFFECTS_ENABLED`:** NOT SET. By default this is absent, so `lib/runtime-env.ts:sideEffectsGuarded()` returns `true` in staging — all external side-effects (emails, AI generation, billing calls) are suppressed on the staging branch.

**`STAGING_SUPABASE_*` variables:** NOT FOUND anywhere in the codebase or docs. No staging-specific Supabase credentials exist.

**Do Production and Preview point at different Supabase projects?** **NO.**  
`SUPABASE_URL` is scoped to "Production, Preview, Development" — the same project is used for all three (`docs/exports/auth-decisions.md:51`). Confirmed explicitly: `docs/testing-roadmap.md:22` states _"Vercel preview deploys use the **production** Supabase project (no staging env exists)."_

---

## 3. Supabase Projects

**How many Supabase projects?** ONE.  
Only one project ref appears anywhere in the codebase: `sazapxgmrdaewrkwoxby.supabase.co`

**Evidence (non-exhaustive):**

| File | Evidence |
|---|---|
| `.env.local:20` | `SUPABASE_URL="https://sazapxgmrdaewrkwoxby.supabase.co"` |
| `.env.production.local:4` | `SUPABASE_URL="https://sazapxgmrdaewrkwoxby.supabase.co"` |
| `.env.bundlesocial-test:4` | Same project ref |
| `scripts/audit-screenshots.ts` | `const SUPABASE_URL = "https://sazapxgmrdaewrkwoxby.supabase.co"` |
| `.env.local.backup-2026-05-18` | Same project ref |
| `.env.production.local.backup-2026-05-18` | Same project ref |

Only one distinct real project ref appears across all scans. Other refs found (`example.supabase.co`, `xyz.supabase.co`, `xyzcompany.supabase.co`, `realtime.supabase.co`) are test fixtures and mock values in test files.

**Project ref summary:**

| Project ref | Purpose | Evidence |
|---|---|---|
| `sazapxgmrdaewrkwoxby` | THE ONLY PROJECT — used for Production, Preview (including staging branch), and local development | `.env.local:20`, `.env.production.local:4`, `docs/exports/auth-decisions.md:51` |

**Critical finding: do Vercel Preview deployments write to the PRODUCTION Supabase?**  
**YES.**

The canonical confirmation is `docs/testing-roadmap.md:21-22`:

> Vercel preview deploys use the **production** Supabase project (no staging env exists). Running E2E against prod would pollute real customer data.

This is the most dangerous active misconfiguration. Every PR preview deploy — including the `staging` branch — reads and writes to the same Supabase database as production.

**Note on the `staging` branch `sideEffectsGuarded()` mitigation:**  
`lib/runtime-env.ts:43-46` returns `sideEffectsGuarded() = true` when `APP_ENV=staging` and `STAGING_SIDE_EFFECTS_ENABLED != "1"`. This suppresses outbound emails and AI generation calls. However, it does **not** prevent direct database writes (INSERTs, UPDATEs, DELETEs) from hitting production Supabase. Any UI interaction, form submission, or API call that touches data will write to the live production database.

---

## 4. Deployment Workflows

Workflows found in `.github/workflows/`:

| Workflow | Trigger | Target environment |
|---|---|---|
| `ci.yml` | PRs + push to `main` | Lint, typecheck, unit, integration (local Supabase), E2E (local Supabase) |
| `deploy-migrations.yml:23-28` | Push to `main` touching `supabase/migrations/` | **Production Supabase only** — hardcoded `environment: production` |
| `smoke.yml:17-20` | `vercel-deploy-success` dispatch + `workflow_dispatch` | Production (`opollo-site-builder.vercel.app`) |
| `release-please.yml` | Push to `main` | Changelog + version bump |
| `codeql.yml`, `gitleaks.yml`, `audit.yml` | Push / PR | Security scanning only |
| `lighthouse.yml`, `screenshots.yml` | PRs | Visual/perf checks |
| `button-migration-gates.yml` | PRs | Static audit |
| `config-drift.yml` | Push to `main` | Config drift detection |
| `e2e.yml` | PRs | Playwright E2E (local Supabase) |

**Is there a workflow that deploys to staging on merge to `staging` branch?** NOT FOUND. No workflow triggers on the `staging` branch. Vercel handles preview deploys automatically for all branches, but no custom staging deploy pipeline exists.

**Is there a `staging` branch in the repo?** YES.

```
remotes/origin/staging
```

Found via `git branch -a`. Also present: `remotes/origin/feat/staging-environment-scaffold`.

**`staging` branch state:**

- Last relevant commit on `staging`: `f582bce8 feat(staging): runtime-env detection + environment-aware guards for email + crons (#946)` — merged approximately 2026-05-20
- `main` is **66 commits ahead** of `staging` (confirmed: `git log --oneline origin/staging..origin/main | wc -l = 66`)
- `staging` has **0 commits** that are not in `main` (`git log --oneline origin/staging ^origin/main` returns empty)
- The staging branch is a stale snapshot of main as of ~PR #947. It has not been updated since the WS5/WS6 hardening pass.

**Is there a "promote to production" workflow?** NOT FOUND. No workflow moves code from `staging` → `main`. This would be a manual merge.

---

## 5. Seed / Test Data

**Seed scripts found:**

| Script | Environment scope |
|---|---|
| `scripts/db-check.ts` | Reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from env — no environment discrimination. Used for connectivity checks only. |
| `scripts/seed-istock-library.ts` | Reads env vars — no staging/prod discrimination. |
| `scripts/seed-leadsource.ts` | Reads env vars — no staging/prod discrimination. |

No seed script specifically targets a non-production environment. No script sets `APP_ENV=staging` before running or checks for it.

**Docs referencing staging seed data:**

- `docs/BACKLOG.md` (line not quoted): explicitly defers "Staging-environment E2E for sync confirm + actual WP publish" — requires provisioning a staging WP instance. Tagged `e2e`, `staging`, `wp-integration`. **Status: deferred** (trigger is paying customer onboarding).
- `docs/testing-roadmap.md:14`: "A 20-browser session load test against a real preview deploy is the next rung — needs a staging Supabase project first." — confirms staging Supabase is a named prerequisite, not yet done.

No seed data policy document exists for staging. There are no dedicated staging seed fixtures.

---

## 6. Architectural Diagnosis

### Classification: **STATE B — Partial (leaning toward C on the most critical axis)**

Checklist:

| Component | State | Notes |
|---|---|---|
| `staging` Git branch | ✅ EXISTS | `origin/staging`, 66 commits behind `main` |
| Vercel Preview deployment for staging branch | ✅ EXISTS | Automatic Vercel preview per push |
| Stable persistent staging URL | ❌ MISSING | No custom domain; ephemeral per-commit URLs only |
| `APP_ENV=staging` override in Vercel | ✅ SET | Confirmed 2026-05-20 |
| Side-effect guards (email redirect, cron skip) | ✅ IMPLEMENTED | `lib/runtime-env.ts`, `lib/platform/cron/cron-shared.ts`, `lib/email/sendgrid.ts` |
| Separate Supabase project for staging | ❌ MISSING — **CRITICAL** | Preview deploys write to production Supabase |
| Staging-specific `SUPABASE_URL` env var | ❌ MISSING | One project ref everywhere |
| Database write isolation | ❌ MISSING | `docs/testing-roadmap.md:22` explicitly confirms |
| Staging-seeded test data | ❌ MISSING | No seed scripts target staging |
| Dedicated staging deploy workflow | ❌ MISSING | Relies on Vercel's automatic preview only |
| `staging` branch kept current with `main` | ❌ MISSING | 66 commits stale |
| Migration workflow for staging | ❌ MISSING | `deploy-migrations.yml` targets production only |

### What is missing (for STATE A)

1. **Separate Supabase project** — the most critical gap. No staging isolation at the database layer.
2. **`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` overrides** scoped to the `staging` branch in Vercel, pointing at a staging Supabase project.
3. **Stable persistent URL** for the staging branch (e.g. a Vercel custom domain alias like `staging.opollo.com` or a Vercel branch alias).
4. **Migration workflow for staging** — `deploy-migrations.yml` needs a staging job that targets the staging Supabase project on push to `staging`.
5. **Seed data policy + script** — a `scripts/seed-staging.ts` that populates staging Supabase with safe test fixtures instead of production data.
6. **`staging` branch kept in sync with `main`** — currently 66 commits stale; needs a rebase strategy (or auto-rebase workflow).

---

## 7. Recommendation

### Current state: STATE B (critical gap = shared Supabase)

The Vercel-side scaffolding is partially in place (branch, `APP_ENV`, side-effect guards). However, **Preview deployments — including the `staging` branch — write directly to the production Supabase database.** This is the dominant risk. Any test, demo, or UAT session on staging can corrupt live customer data.

### Recommended PR sequence (to reach STATE A)

Each PR is independently shippable in the order listed (dependency: PR-A must ship before PR-B, PR-B before PR-C, PR-D is independent).

---

**PR-A: Provision Supabase staging project**  
_Prerequisite to everything else. Steven action required (external signup / Supabase dashboard)._

- Create a new Supabase project (suggested name: `opollo-site-builder-staging`) in the same organisation.
- Run `supabase db push --linked` against the new project to apply all migrations.
- Note the project ref, anon key, service role key.
- Estimated effort: ~1 hour (mostly waiting for Supabase provisioning + migration run).
- **Hard stop:** external dashboard action. Steven must do this; cannot be automated from the repo.

---

**PR-B: Wire staging env vars in Vercel**  
_Depends on PR-A (need the new project credentials)._

- In Vercel dashboard → Project → Settings → Environment Variables:
  - Add `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` scoped to the `staging` Git branch only, pointing at the new staging Supabase project.
- Optionally assign a Vercel branch alias (e.g. `staging.opollo-site-builder.vercel.app`) in Vercel dashboard.
- No code changes required; this is a Vercel dashboard operation.
- **Hard stop:** Vercel dashboard config the agent cannot access.

---

**PR-C: Staging migration workflow**  
_Depends on PR-B (need staging project ref as a GitHub secret)._

- Add `SUPABASE_STAGING_PROJECT_REF`, `SUPABASE_STAGING_DB_PASSWORD` as GitHub Actions secrets.
- Extend `.github/workflows/deploy-migrations.yml` with a second job that targets the staging project on push to the `staging` branch (mirror the existing `push` job with `branches: [staging]` and staging-scoped secrets).
- ~30 lines added to `deploy-migrations.yml`.
- No database changes.
- Estimated: 1 PR, ~50 net lines.

---

**PR-D: Staging seed script + rebase policy**  
_Independent of A–C; can be written before staging Supabase exists._

- Add `scripts/seed-staging.ts`: populates the staging Supabase with a deterministic set of test companies, users, sites, and social connections using the service role key. Does NOT use production credentials.
- Add a `package.json` script: `"seed:staging": "SUPABASE_URL=$STAGING_SUPABASE_URL npx tsx scripts/seed-staging.ts"`.
- Document in `README.md` under a "Staging" section.
- Establish a `staging` branch rebase cadence: either a weekly manual rebase of `staging` onto `main`, or a GitHub Actions workflow that opens a "rebase staging" PR weekly.
- Estimated: 1 PR, ~150 net lines.

---

### If UAT harness is the goal

Do not build a UAT harness until at minimum **PR-A + PR-B** are complete. Without database isolation, any UAT session that creates test posts, users, or social connections will write those records to the production database. The side-effect guards (`sideEffectsGuarded()`) only block outbound API calls — they do not prevent Supabase writes.

Once PR-A + PR-B are shipped, the testing-roadmap flip is straightforward (`docs/testing-roadmap.md:26-27`):
> "When staging Supabase lands, flip `PLAYWRIGHT_BASE_URL` to the preview URL + point `SUPABASE_*` env vars at the staging project. No Playwright code changes needed."

---

## 8. RESOLVED — 2026-05-24

The three PRs below executed the recommendation above (renamed PR-A/B/C/D to PR-C/D/E to avoid conflict with other in-flight PR naming):

### What was done

| Item | Status | Detail |
|---|---|---|
| Staging Supabase project provisioned | ✅ Done by Steven | `bjiiqnetaxoibhcaukqm` |
| `APP_ENV=staging` set in Vercel | ✅ Already done | Confirmed 2026-05-20 |
| `NEXT_PUBLIC_SUPABASE_URL` override set | ✅ Done by Steven | Has typo (BLOCKED-2) |
| `SUPABASE_SERVICE_ROLE_KEY` staging override | ✅ Done by Steven | |
| `SUPABASE_PROJECT_REF` staging override | ✅ Done by Steven | |
| All 151 migrations applied to staging | ✅ Verified | Migration 0109 repaired; 0151 added for Pg17 compat |
| `staging-migrations.yml` GitHub Actions workflow | ✅ PR-C | Auto-applies on push to `staging` branch |
| `/api/debug/env-check` runtime endpoint | ✅ PR-C | Returns 404 in production |
| `env-check-production-guard` CI gate | ✅ PR-C | Statically verifies production guard in CI |
| Audit allowlist for env-check route | ✅ PR-C | Added to `ALLOWLIST_PUBLIC_API_PATHS` |
| Seed script `scripts/seed-uat-staging.ts` | ✅ PR-D | Idempotent; hard-fails if run against production |
| `seed:staging` npm script | ✅ PR-D | |
| Seed data verified in staging Supabase | ✅ Verified | 2 companies, 1 UAT user, 5 drafts, 10 images, 3 social connections, 1 analytics snapshot |
| `docs/staging/README.md` | ✅ PR-C | Full environment documentation |
| `docs/staging/BLOCKED.md` | ✅ PR-C | External action items for Steven |
| `docs/uat-harness/PREREQUISITES.md` | ✅ PR-E | What the UAT harness will need |
| `docs/staging/state-a-verification-2026-05-24.md` | ✅ PR-E | Verification checklist |

### What remains blocked (external actions — Steven only)

| # | Item | Impact |
|---|---|---|
| BLOCKED-1 | `SUPABASE_URL` Preview branch override for `staging` → `https://bjiiqnetaxoibhcaukqm.supabase.co` | CRITICAL: server routes still write to prod without this |
| BLOCKED-2 | Fix `NEXT_PUBLIC_SUPABASE_URL` typo (missing `h`) | HIGH: client-side queries fail |
| BLOCKED-3 | GitHub Actions secrets: `STAGING_SUPABASE_PROJECT_REF`, `STAGING_SUPABASE_DB_PASSWORD` | MEDIUM: migration workflow fails |
| BLOCKED-4 | `STAGING_UAT_PASSWORD` GitHub Actions secret | MEDIUM: UAT user can't authenticate via password |

See `docs/staging/BLOCKED.md` for exact dashboard navigation paths.

### Critical note on BLOCKED-1

Until BLOCKED-1 is resolved, all server-side API routes on the staging branch still read/write from **production Supabase** (`sazapxgmrdaewrkwoxby`). The `SUPABASE_URL` environment variable used by `lib/supabase.ts:getServiceRoleClient()` has not been overridden for the staging branch. This was the original critical risk identified in §3 above, and it persists until Steven adds the branch-specific Vercel env var override.

Once BLOCKED-1 and BLOCKED-2 are fixed and a new staging deployment runs, verify with:
```bash
curl https://opollo-site-builder-git-staging-opollo5.vercel.app/api/debug/env-check
# Expected: supabase_url → bjiiqnetaxoibhcaukqm, not sazapxgmrdaewrkwoxby
```
