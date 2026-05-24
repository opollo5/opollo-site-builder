# Staging — Blocked Items

_Updated 2026-05-24 after Steven resolved BLOCKED-1 through BLOCKED-4._

---

## ✅ RESOLVED: BLOCKED-1 — SUPABASE_URL for staging branch

**Resolved by Steven 2026-05-24.** Branch-specific `SUPABASE_URL` override added in Vercel for the `staging` branch.

**Original issue:** `SUPABASE_URL` was shared across all Preview environments pointing at production Supabase (`sazapxgmrdaewrkwoxby`).

---

## ✅ RESOLVED: BLOCKED-2 — NEXT_PUBLIC_SUPABASE_URL typo

**Resolved by Steven 2026-05-24.** Typo fixed (`ttps://` → `https://`).

---

## ✅ RESOLVED: BLOCKED-3 — GitHub Actions secrets for staging migrations

**Resolved by Steven 2026-05-24.** `STAGING_SUPABASE_PROJECT_REF` and `STAGING_SUPABASE_DB_PASSWORD` added.

**Verified:** `staging-migrations.yml` workflow triggered and ran successfully — migration step: `Remote database is up to date` (151/151, no-op). Workflow run: https://github.com/opollo5/opollo-site-builder/actions/runs/26352508592

---

## ✅ RESOLVED: BLOCKED-4 — STAGING_UAT_PASSWORD

**Resolved by Steven 2026-05-24.** `STAGING_UAT_PASSWORD` GitHub Actions secret added (value: `opollo_UAT_Login01`).

---

## BLOCKED-5: STAGING_SUPABASE_URL and STAGING_SUPABASE_SERVICE_KEY GitHub Actions secrets

**Severity:** MEDIUM — seed workflow step fails; migration push works fine  
**Type:** GitHub Actions secrets (agent cannot set)

**Evidence:** `staging-migrations.yml` workflow run https://github.com/opollo5/opollo-site-builder/actions/runs/26352508592 shows:
```
SUPABASE_URL: 
SUPABASE_SERVICE_ROLE_KEY: 
[SEED FAIL] SUPABASE_URL is not set.
```

The workflow seed step uses:
```yaml
env:
  SUPABASE_URL: ${{ secrets.STAGING_SUPABASE_URL }}
  SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.STAGING_SUPABASE_SERVICE_KEY }}
```

Both secrets are not set. The seed script hard-fails when `SUPABASE_URL` is empty.

**Fix required:**  
GitHub → opollo5/opollo-site-builder → Settings → Secrets and variables → Actions → New repository secret:

| Secret name | Value |
|---|---|
| `STAGING_SUPABASE_URL` | `https://bjiiqnetaxoibhcaukqm.supabase.co` |
| `STAGING_SUPABASE_SERVICE_KEY` | The staging service-role key (Supabase dashboard → `bjiiqnetaxoibhcaukqm` → Project Settings → API → service_role) |

**Impact if missing:** The seed step in `staging-migrations.yml` fails on every run. The migration push still succeeds. Current seed data is already correct (verified 2026-05-24 via PostgREST).

---

## BLOCKED-6: Vercel SSO blocks env-check endpoint from external curl

**Severity:** LOW — verification only; the endpoint is deployed and works  
**Type:** Vercel dashboard setting (optional — browser workaround available)

**Evidence:**
```
curl https://opollo-site-builder-git-staging-opollo5.vercel.app/api/debug/env-check
→ HTTP 401 (Vercel Preview Protection SSO authentication wall)
```

The staging branch deployment is behind Vercel Preview Protection. External curl is redirected to Vercel's SSO login before reaching the Next.js app.

**What IS verified without the endpoint (database-level isolation confirmed):**
- Staging Supabase `bjiiqnetaxoibhcaukqm` has correct seed data ✅
- Production Supabase `sazapxgmrdaewrkwoxby` has zero UAT rows ✅
- Production CSP header confirms production uses `sazapxgmrdaewrkwoxby` ✅
- Steven confirmed BLOCKED-1 (SUPABASE_URL override) resolved ✅

**Fix options (optional — pick whichever is easier):**

**Option A — Verify via browser:** Open `https://opollo-site-builder-git-staging-opollo5.vercel.app/api/debug/env-check` in a browser while logged into Vercel. Confirm `"supabase_url"` contains `bjiiqnetaxoibhcaukqm`.

**Option B — Add Protection Bypass Secret:** Vercel → Project → Settings → Deployment Protection → "Protection Bypass for Automation" → generate a secret. Then curl with `-H "x-vercel-protection-bypass: <secret>"`.

**Option C — Disable Preview Protection:** Vercel → Project → Settings → Deployment Protection → uncheck "Vercel Authentication" for Preview.
