# Staging Environment

## Overview

The `staging` branch is deployed by Vercel as a persistent Preview environment,
with `APP_ENV=staging` and a dedicated Supabase project, fully isolated from
production.

**Staging Supabase project:** `bjiiqnetaxoibhcaukqm`
**Staging URL pattern:** `https://opollo-site-builder-git-staging-opollo5.vercel.app`
_(per-commit ephemeral URLs also available from Vercel dashboard)_

---

## Environment isolation

| Layer | Staging | Production |
|---|---|---|
| Supabase project | `bjiiqnetaxoibhcaukqm` | `sazapxgmrdaewrkwoxby` |
| `APP_ENV` | `staging` | (unset — defaults to `production`) |
| `VERCEL_ENV` | `preview` | `production` |
| Outbound emails | Redirected to `STAGING_EMAIL_RECIPIENT` | Sent to real recipients |
| AI generation (LLM calls) | Blocked unless `STAGING_SIDE_EFFECTS_ENABLED=1` | Enabled |
| Cron jobs | Skipped via `guardedCronSkip()` | Run normally |

### Runtime verification

Hit the diagnostic endpoint to confirm isolation at any time:

```bash
curl https://opollo-site-builder-git-staging-opollo5.vercel.app/api/debug/env-check
```

Expected response:
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

The same endpoint returns **404 on production** — this guards against leaking
deployment info from the live environment.

---

## Migrations

Migrations are automatically applied to staging when changes to
`supabase/migrations/**` are pushed to the `staging` branch:

```
.github/workflows/staging-migrations.yml
  → on push to staging + migrations path
  → supabase db push --linked --include-all
```

Required GitHub Actions secrets:
- `STAGING_SUPABASE_PROJECT_REF` = `bjiiqnetaxoibhcaukqm`
- `SUPABASE_ACCESS_TOKEN` (shared with production workflow)
- `STAGING_SUPABASE_DB_PASSWORD` (from Supabase dashboard → Project Settings → Database)

See `docs/staging/BLOCKED.md` if these secrets are not yet configured.

### Manual migration run

```bash
SUPABASE_ACCESS_TOKEN="$(grep SUPABASE_ACCESS_TOKEN .env.local | cut -d= -f2 | tr -d '"')"
export SUPABASE_ACCESS_TOKEN
supabase link --project-ref bjiiqnetaxoibhcaukqm
supabase db push --linked --include-all
```

---

## Seed data

UAT test data is seeded by `scripts/seed-uat-staging.ts`.
The seed script is idempotent — safe to run multiple times.

```bash
# Requires .env.staging.local (pulled via `vercel env pull --environment=preview .env.staging.local`)
# Override the SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to point at staging project
npx tsx scripts/seed-uat-staging.ts
```

Expected state after seed:

| Table | Rows | Description |
|---|---|---|
| `platform_companies` | ≥1 | `uat-staging` company |
| `platform_users` | ≥1 | `uat-bot@staging.opollo.com` |
| `social_post_drafts` | 5 | 1 draft, 2 scheduled, 1 publishing, 1 published |
| `social_connections` | 3 | 1 LinkedIn, 1 Facebook expired, 1 X pending |
| `image_library` | 10 | Mixed source types |
| `social_post_analytics_snapshots` | 1 | For the published draft |

---

## UAT harness sign-in

The UAT ghost user authenticates via a service-role bypass route (to be built
in the UAT harness session). Until that route exists, test manually:

- Email: `uat-bot@staging.opollo.com`
- Password: set via `STAGING_UAT_PASSWORD` secret (see `docs/staging/BLOCKED.md`)

---

## Keeping staging in sync with main

The `staging` branch should be kept close to `main`. Recommended practice:
- After each batch of PRs merges to `main`, open a PR: `main → staging`
- This brings staging up to date and triggers the migration workflow

---

## State A checklist

- [x] `staging` Git branch exists
- [x] `APP_ENV=staging` set in Vercel for staging branch
- [x] `NEXT_PUBLIC_SUPABASE_URL` set to staging Supabase in Vercel
- [x] `SUPABASE_SERVICE_ROLE_KEY` set to staging key in Vercel
- [x] `SUPABASE_PROJECT_REF` set in Vercel
- [x] Side-effect guards in place (`lib/runtime-env.ts`)
- [x] `staging-migrations.yml` workflow created
- [x] `/api/debug/env-check` runtime verification endpoint
- [ ] `SUPABASE_URL` staging branch override in Vercel (**BLOCKED-1**)
- [ ] `NEXT_PUBLIC_SUPABASE_URL` typo fixed (**BLOCKED-2**)
- [ ] GitHub Actions secrets configured (**BLOCKED-3**)
- [x] All migrations applied to staging Supabase (151/151 — verified 2026-05-24)
- [x] Seed data present (verified 2026-05-24)
- [x] End-to-end verification doc created (`docs/staging/state-a-verification-2026-05-24.md`)
