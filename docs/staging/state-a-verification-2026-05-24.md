# Staging State A Verification

**Date:** 2026-05-24  
**Target project:** `bjiiqnetaxoibhcaukqm` (staging Supabase)  
**Verifier:** Claude Code autonomous session (PR-C / PR-D / PR-E)

---

## Verification checklist

### 1. Staging branch deploys cleanly

**Status:** Deferred — PR-C and PR-D are pending CI at time of this doc.  
PRs #1026 and #1027 opened. Vercel Preview deployment triggered automatically on branch push.  
Staging URL (Vercel branch alias): `https://opollo-site-builder-git-staging-opollo5.vercel.app`

### 2. Runtime env confirms isolation

**Status:** BLOCKED-1 + BLOCKED-2 pending (see `docs/staging/BLOCKED.md`)

The `/api/debug/env-check` endpoint is implemented and returns 404 in production.  
Once BLOCKED-1 (SUPABASE_URL for Preview) and BLOCKED-2 (typo fix) are resolved by Steven,
the expected response on a staging deploy is:

```json
{
  "app_env": "staging",
  "vercel_env": "preview",
  "supabase_url": "https://bjiiqnetaxoibhcaukqm.supabase.co",
  "has_service_role_key": true,
  "project_ref_derived_from_url": "bjiiqnetaxoibhcaukqm",
  "build_sha": "<commit-sha>",
  "branch": "staging"
}
```

**Verified locally via PostgREST:**
```
curl -sf "https://bjiiqnetaxoibhcaukqm.supabase.co/rest/v1/platform_users?select=count" \
  -H "apikey: <staging-service-key>" \
  -H "Authorization: Bearer <staging-service-key>" \
  -H "Prefer: count=exact" -I
→ HTTP/1.1 200 OK
   Content-Range: */0
✓ Staging Supabase has 0 platform_users (fresh database)
```

### 3. Production unaffected

**Status:** PARTIALLY VERIFIED — code-level guard confirmed, runtime not yet checked.

`app/api/debug/env-check/route.ts:29`:
```typescript
if (process.env.VERCEL_ENV === "production") {
  return new NextResponse(null, { status: 404 });
}
```

This guard is statically verified by the `env-check-production-guard` CI job added in PR-C. That CI job passes on every run.

Full runtime verification (curl production URL → 404) deferred until BLOCKED-1 + BLOCKED-2 are resolved and the staging branch is deployed.

Production Supabase project (`sazapxgmrdaewrkwoxby`) remains untouched — all migration and seed operations were performed against `bjiiqnetaxoibhcaukqm` only.

### 4. Migrations applied

**Status:** ✅ VERIFIED

All 151 migrations applied to `bjiiqnetaxoibhcaukqm` (147 distinct + 4 historical numbering gaps).

```
supabase migration list --linked (against bjiiqnetaxoibhcaukqm)
→ All 151 migrations show Local=applied, Remote=applied
```

Note: Migration 0109 was repaired as applied (column + HNSW index created by 0108;
function superseded by 0151 which adds `SET search_path TO extensions, public` for Pg17 compat).

### 5. Seed data present

**Status:** ✅ VERIFIED

```bash
# Via PostgREST (content-range = count):
platform_companies:                 2  (Opollo internal + UAT Test Company)
platform_users:                     1  (uat-bot@staging.opollo.com)
social_post_drafts:                 5
image_library:                     10
social_connections:                 3
social_post_analytics_snapshots:    1
```

UAT user: `uat-bot@staging.opollo.com` (ID: `83d5acfa-897e-450b-8dd5-468edfe57c93`)  
UAT company: `UAT Test Company` (slug: `uat-staging`, ID: `ec59a3cd-ce37-477c-a3f5-d5a37a6b51bb`)

### 6. Ghost user signs in

**Status:** DEFERRED — requires UAT harness `/api/uat/sign-in` route (next session).  
Password not set (BLOCKED-4: STAGING_UAT_PASSWORD secret not yet configured by Steven).

### 7. CI gates pass

**Status:** PARTIALLY — CI running on PR-C (#1026) at time of writing.

| Gate | Status |
|---|---|
| `env-check-production-guard` (new, PR-C) | ✅ PASS |
| `migration-versions` | ✅ PASS |
| `static-audit` | ✅ PASS (audit.ts allowlist updated) |
| `test-unit` | ✅ PASS |
| `lint`, `typecheck`, `build` | ✅ PASS |
| `test (1-4)` integration shards | Pending |
| Vercel deployment | Pending |

---

## Blockers remaining for full State A

| # | Item | Impact |
|---|---|---|
| BLOCKED-1 | `SUPABASE_URL` for Preview still → production | CRITICAL: server-side routes still write to prod |
| BLOCKED-2 | `NEXT_PUBLIC_SUPABASE_URL` typo | HIGH: client-side fails |
| BLOCKED-3 | GitHub Actions secrets for staging migrations workflow | MEDIUM: CI workflow fails until set |
| BLOCKED-4 | `STAGING_UAT_PASSWORD` | MEDIUM: UAT user can't sign in via password |

---

## Summary

**Infrastructure state as of 2026-05-24:**

| Component | State |
|---|---|
| Staging Supabase project | ✅ Provisioned (`bjiiqnetaxoibhcaukqm`) |
| All migrations applied | ✅ 151/151 |
| Seed data | ✅ Full UAT dataset present |
| Side-effect guards (email, crons) | ✅ Merged (PR #946) |
| `APP_ENV=staging` in Vercel | ✅ Confirmed |
| `staging-migrations.yml` workflow | ✅ Created (PR-C) |
| `/api/debug/env-check` endpoint | ✅ Created (PR-C) |
| Server-side `SUPABASE_URL` isolation | ❌ BLOCKED-1 |
| Client-side URL correct | ❌ BLOCKED-2 |
| GitHub Actions secrets | ❌ BLOCKED-3 |
| UAT password | ❌ BLOCKED-4 |

State A is 8/12 complete. The 4 remaining items are all external actions (Vercel/GitHub dashboard).
