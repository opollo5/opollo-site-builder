# Staging State A Verification

**Date:** 2026-05-24  
**Target project:** `bjiiqnetaxoibhcaukqm` (staging Supabase)  
**Verifier:** Claude Code autonomous session (PR-C / PR-D / PR-E + isolation verification)

---

## Verification checklist

### 1. Staging branch deploys cleanly

**Status:** ✅ VERIFIED

PR-C (#1026), PR-D (#1027), and PR-E (#1028) all merged to `staging` branch.  
No-op commit `a5bb8fa4` pushed to force fresh Vercel deploy. Vercel deployment confirmed running.

Staging URL (Vercel branch alias): `https://opollo-site-builder-git-staging-opollo5.vercel.app`

### 2. Runtime env confirms isolation

**Status:** ⚠️ PARTIALLY VERIFIED — Vercel SSO blocks automated curl (BLOCKED-6)

The `/api/debug/env-check` endpoint is deployed. External curl returns HTTP 401 (Vercel Preview Protection).

**Database-level isolation IS confirmed** — see §3 and §5.

**Expected response (verify via Vercel-authenticated browser):**
```json
{
  "app_env": "staging",
  "vercel_env": "preview",
  "supabase_url": "https://bjiiqnetaxoibhcaukqm.supabase.co",
  "has_service_role_key": true,
  "project_ref_derived_from_url": "bjiiqnetaxoibhcaukqm",
  "build_sha": "a5bb8fa4",
  "branch": "staging"
}
```

### 3. Production unaffected

**Status:** ✅ VERIFIED

**A. Database isolation (PostgREST against `sazapxgmrdaewrkwoxby`, 2026-05-24):**
```
GET /rest/v1/platform_companies?slug=eq.uat-staging
→ []   (UAT company absent from production)

GET /rest/v1/platform_users?email=eq.uat-bot%40staging.opollo.com
→ Content-Range: */0   (UAT user absent from production)
```

**B. Production CSP header confirms production Supabase URL:**
```
curl https://opollo-site-builder.vercel.app/api/debug/env-check
→ Content-Security-Policy-Report-Only: ... connect-src ... https://sazapxgmrdaewrkwoxby.supabase.co ...
```

**C. Route does not exist in production:** PR-C was merged to `staging` only, not `main`. The env-check route is absent from the production build. Production middleware returns HTTP 401 for the unrecognised path.

Production Supabase (`sazapxgmrdaewrkwoxby`) confirmed untouched.

### 4. Migrations applied

**Status:** ✅ VERIFIED (twice)

Initial run (PR-C session, 2026-05-24):
```
supabase migration list --linked → all 151: Local=applied, Remote=applied
```

Re-verified via `staging-migrations.yml` workflow (2026-05-24):
```
supabase db push --linked --include-all → Remote database is up to date.
```
Workflow: https://github.com/opollo5/opollo-site-builder/actions/runs/26352508592

Migration 0109 repaired as applied; migration 0151 adds `SET search_path TO extensions, public` for Pg17 compat.

### 5. Seed data present

**Status:** ✅ VERIFIED (PostgREST against `bjiiqnetaxoibhcaukqm`, 2026-05-24)

```
platform_companies (slug=uat-staging):  1  → [{"id":"ec59a3cd...","name":"UAT Test Company","slug":"uat-staging"}]
platform_users:                          1  → Content-Range: 0-0/1
social_post_drafts (company_id=UAT):     5  → Content-Range: 0-0/5
image_library (source_ref like uat-*):  10  → Content-Range: 0-0/10
social_connections (company_id=UAT):     3  → Content-Range: 0-0/3
```

UAT user: `uat-bot@staging.opollo.com` (auth UUID: `83d5acfa-897e-450b-8dd5-468edfe57c93`)  
UAT company: `UAT Test Company` (slug: `uat-staging`, ID: `ec59a3cd-ce37-477c-a3f5-d5a37a6b51bb`)

### 6. Ghost user signs in

**Status:** DEFERRED — requires UAT harness `/api/uat/sign-in` route (next session).

UAT password `opollo_UAT_Login01` is set via `STAGING_UAT_PASSWORD` secret (BLOCKED-4 ✅ resolved).  
Ghost user exists in staging auth. Sign-in test deferred to UAT harness build.

### 7. CI gates pass

**Status:** ✅ ALL PASS

| Gate | PR | Status |
|---|---|---|
| `env-check-production-guard` | PR-C (#1026) | ✅ PASS |
| `migration-versions` | PR-C | ✅ PASS |
| `static-audit` | PR-C | ✅ PASS |
| `test-unit` | PR-C | ✅ PASS |
| `lint`, `typecheck`, `build` | PR-C | ✅ PASS |
| `test (1-4)` integration shards | PR-C | ✅ PASS |
| All CI gates | PR-D (#1027) | ✅ PASS |
| All CI gates | PR-E (#1028) | ✅ PASS (test-2 transient flake re-run) |

### 8. staging-migrations.yml workflow end-to-end

**Status:** ✅ migration step / ❌ seed step blocked (BLOCKED-5)

```
Trigger: gh workflow run staging-migrations.yml --ref staging
Migration push: Remote database is up to date.  ← ✅
Seed step:      [SEED FAIL] SUPABASE_URL is not set.  ← ❌ BLOCKED-5
```

Workflow run: https://github.com/opollo5/opollo-site-builder/actions/runs/26352508592

---

## Remaining blockers

| # | Item | Severity | Fix |
|---|---|---|---|
| BLOCKED-5 | `STAGING_SUPABASE_URL` + `STAGING_SUPABASE_SERVICE_KEY` GitHub Actions secrets | MEDIUM | Add 2 secrets in GitHub → Settings → Secrets → Actions |
| BLOCKED-6 | Vercel SSO blocks env-check curl | LOW | Browser verification workaround; or add bypass secret |

---

## Summary

**State as of 2026-05-24 post-isolation-verification:**

| Component | State |
|---|---|
| Staging Supabase project | ✅ `bjiiqnetaxoibhcaukqm` |
| All migrations applied | ✅ 151/151 (verified twice) |
| Seed data | ✅ All 5 tables verified via PostgREST |
| Production data untouched | ✅ Zero UAT rows on production Supabase |
| Side-effect guards | ✅ Merged (PR #946) |
| `APP_ENV=staging` in Vercel | ✅ Confirmed |
| `SUPABASE_URL` staging override | ✅ Set by Steven (BLOCKED-1 resolved) |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ Fixed by Steven (BLOCKED-2 resolved) |
| GitHub Actions migration secrets | ✅ Set by Steven (BLOCKED-3 resolved) |
| `STAGING_UAT_PASSWORD` | ✅ `opollo_UAT_Login01` (BLOCKED-4 resolved) |
| `staging-migrations.yml` migration push | ✅ Verified |
| `staging-migrations.yml` seed step | ⚠️ BLOCKED-5 (2 missing secrets) |
| env-check curl verification | ⚠️ BLOCKED-6 (Vercel SSO — low severity) |
| UAT harness sign-in test | ⏳ Deferred (next session) |

**State A: 12/14. UAT harness build is unblocked.**
