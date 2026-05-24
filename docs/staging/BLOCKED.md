# Staging — Blocked Items

Logged during PR-C implementation (2026-05-24).
Items are cleared once Steven resolves the blocker and continues the session.

---

## BLOCKED-1: SUPABASE_URL for Preview still points at production

**Severity:** CRITICAL — server-side code still writes to production Supabase on staging deploys  
**Type:** Vercel dashboard action (agent cannot perform)

**Evidence:** `vercel env pull --environment=preview .env.staging.local` returned:
```
SUPABASE_URL="https://sazapxgmrdaewrkwoxby.supabase.co"
```
`lib/supabase.ts:25` uses `SUPABASE_URL` (not `NEXT_PUBLIC_SUPABASE_URL`) to initialise the service-role client.
The four new env vars added (`SUPABASE_PROJECT_REF`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) only cover client-side and the migration CLI. **All server-side API routes still hit production Supabase in Preview deployments until this is fixed.**

**Fix required:**
In Vercel dashboard → opollo-site-builder → Settings → Environment Variables:
- Find `SUPABASE_URL` — it is currently scoped to `Development, Preview, Production` pointing at `https://sazapxgmrdaewrkwoxby.supabase.co`
- Add a NEW override specifically for the `staging` Git branch (Vercel supports branch-specific env overrides under Preview):
  - Variable: `SUPABASE_URL`
  - Value: `https://bjiiqnetaxoibhcaukqm.supabase.co`
  - Environment: Preview
  - Git branch: `staging`
- Also add `SUPABASE_ANON_KEY` staging branch override:
  - Variable: `SUPABASE_ANON_KEY`
  - Value: (the anon key from bjiiqnetaxoibhcaukqm — same as NEXT_PUBLIC_SUPABASE_ANON_KEY already set)
  - Environment: Preview
  - Git branch: `staging`

---

## BLOCKED-2: NEXT_PUBLIC_SUPABASE_URL has a typo (missing `h`)

**Severity:** HIGH — client-side Supabase will fail to connect on staging deploys  
**Type:** Vercel dashboard action (agent cannot perform)

**Evidence:** `vercel env pull` returned:
```
NEXT_PUBLIC_SUPABASE_URL="ttps://bjiiqnetaxoibhcaukqm.supabase.co"
```
Missing leading `h` — should be `https://...`

**Fix required:**
In Vercel dashboard → opollo-site-builder → Settings → Environment Variables:
- Find `NEXT_PUBLIC_SUPABASE_URL` (set ~7 minutes ago for Preview)
- Correct the value to: `https://bjiiqnetaxoibhcaukqm.supabase.co`

---

## BLOCKED-3: STAGING_SUPABASE_PROJECT_REF and STAGING_SUPABASE_DB_PASSWORD GitHub Actions secrets

**Severity:** MEDIUM — staging-migrations.yml workflow will fail in CI  
**Type:** GitHub Actions secrets (agent cannot set)

The workflow `.github/workflows/staging-migrations.yml` created in PR-C requires:
- `STAGING_SUPABASE_PROJECT_REF` = `bjiiqnetaxoibhcaukqm`
- `STAGING_SUPABASE_DB_PASSWORD` = (Steven has it — needed for `supabase db push --linked`)
- `SUPABASE_ACCESS_TOKEN` — verify it already exists (it is used in `deploy-migrations.yml`)

**Fix required:**
In GitHub → opollo5/opollo-site-builder → Settings → Secrets and variables → Actions → New repository secret:
- `STAGING_SUPABASE_PROJECT_REF` = `bjiiqnetaxoibhcaukqm`
- `STAGING_SUPABASE_DB_PASSWORD` = (the database password for `bjiiqnetaxoibhcaukqm`)
- Confirm `SUPABASE_ACCESS_TOKEN` already exists (it is used in `deploy-migrations.yml`)

**Impact if missing:** The `staging-migrations.yml` workflow will be created in code but will fail when triggered until these secrets are added. Migrations can still be applied manually via CLI in the meantime.

---

## BLOCKED-4: STAGING_UAT_PASSWORD GitHub Actions secret (for PR-D seed workflow)

**Severity:** MEDIUM — seed workflow step will fail in CI  
**Type:** GitHub Actions secret

Required for `scripts/seed-uat-staging.ts` to set the UAT ghost user password.

**Fix required:** Choose a password for `uat-bot@staging.opollo.com` and add:
- GitHub secret name: `STAGING_UAT_PASSWORD`
- Value: any strong password (e.g. generated with `openssl rand -base64 24`)

Seed script will log a warning and continue if missing; the user will still be created with `email_confirm: true`.
