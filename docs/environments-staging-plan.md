# Staging Environment Plan

**Status:** Pending execution — read this document, complete the action items in
order, then open a PR with the workflow and seed-script changes described below.

**Written:** 2026-06-05 · **Author:** Claude Code (investigation session)

---

## 1. Background and problem statement

The preview Supabase project (`bjiiqnetaxoibhcaukqm`) and the production project
(`sazapxgmrdaewrkwoxby`) are completely separate Postgres instances. The
`deploy-migrations.yml` workflow only targets production. The staging DB was
built from an early prod dump plus selective manual applies and has never
received migrations through the standard pipeline.

Result: the preview deployment at `opollo-site-builder-*.vercel.app` is
functionally broken for any feature merged after roughly migration 0122 — it
is missing ≥60 migrations, including the entire feedback module (0179–0184),
the workflow engine (0172–0176), magic links (0174), image generation
(0159–0171), CAP phase 1 (0137–0139), insights (0144–0153), and more.

---

## 2. Migration drift findings

Investigated 2026-06-05 by querying PostgREST with HTTP-200-strict checks
(no false positives). Both project refs confirmed from Vercel env.

| Environment | Supabase project ref | Migrations applied |
|---|---|---|
| **Production** | `sazapxgmrdaewrkwoxby` | 0001–0184 (184 total; 0016 and 0128–0130 intentionally absent) |
| **Staging** | `bjiiqnetaxoibhcaukqm` | Non-sequential subset — see table below |

### Staging schema landmarks (strict HTTP-200 check)

| Result | Landmark | Migration |
|---|---|---|
| ✓ present | `opollo_users.id` | 0063 |
| ✓ present | `platform_users.id`, `platform_companies.id` | 0070 |
| ✓ present | `social_connections.id` | 0110 |
| ✓ present | `platform_events.id` | 0111 |
| ✓ present | `social_post_drafts.id` | 0112 |
| ✓ present | `error_reports.id` | 0115 |
| ✓ present | `platform_companies.bundle_social_team_id` | 0116 |
| ✓ present | `platform_social_profiles.id` | 0118 |
| ✓ present | `social_connections.profile_id` | 0120 |
| ✓ present | `social_connections.external_identity_hash` | 0122 |
| ✓ present | `social_post_drafts.planned_for_at` | 0132 |
| ✗ **missing** | `social_analytics.id` | 0121 |
| ✗ **missing** | `social_connections.channel_type` | 0123 |
| ✗ **missing** | `webhook_events.team_id` | 0125 |
| ✗ **missing** | `social_connections.last_seen_at`, `social_post_drafts.claim_id` | 0126 |
| ✗ **missing** | `social_post_drafts.composer_version` | 0127 |
| ✗ **missing** | `social_post_drafts.recurring_draft_id` | 0131 |
| ✗ **missing** | `social_post_drafts.analytics_cache` | 0134 |
| ✗ **missing** | `cron_jobs.id` | 0135 |
| ✗ **missing** | `insights_clients.id` (and all insights tables) | 0144 |
| ✗ **missing** | `image_generation_jobs.id` | 0159 |
| ✗ **missing** | `image_generation_batches.id` | 0161 |
| ⚠ partial | `image_templates.id` present BUT `.title` and `.schema_version` absent | 0162 vs 0166 |
| ✗ **missing** | `image_selections.id` | 0164 |
| ✗ **missing** | `company_workflow_gates.id` | 0172 |
| ✗ **missing** | `magic_links.id` | 0174 |
| ✗ **missing** | `social_post_proof_versions.id` | 0175 |
| ✗ **missing** | `company_workflow_steps.id` | 0176 |
| ✗ **missing** | `platform_users.portal_contact_email` | 0177 |
| ✗ **missing** | `platform_connections.pre_expiry_sent_at` | 0178 |
| ✗ **missing** | `feedback_tickets.id` (entire table) | 0179 |
| ✗ **missing** | `feedback_tickets.resolution_notes` | 0180 |
| ✗ **missing** | `feedback_tickets.expected_behavior` | 0181 |
| ✗ **missing** | `feedback_tickets.ticket_number` | 0182 |
| ✗ **missing** | `platform_users.preferences` | 0183 |
| ✗ **missing** | `feedback_tickets.debug_snapshot` | 0184 |

**Why the gaps are non-sequential:** The staging DB schema was not built by
replaying migrations in order. It was built from a prod dump taken at some
point around migration 0122, plus some migrations applied manually out-of-band
(explaining why `social_post_drafts.planned_for_at` from 0132 exists while
0126–0131 are absent, and why `image_templates` exists with a different column
set than the current 0162 migration produces).

**Consequence:** A blind `supabase db push --include-all` against the current
staging DB will fail mid-run on dependency conflicts — later migrations ALTER
columns or reference tables created by skipped earlier ones.

---

## 3. Chosen resolution: Option A — fresh staging project reset

**Selected path.** Do not attempt in-place repair.

Rationale: the staging DB contains no production data. The only rows that
matter are the two `opollo_users` entries (`uat-bot@staging.opollo.com` and
`steven.m@opollo.com`), which are re-created by the seed script in §5.
A fresh reset gives a guaranteed clean sequential baseline in ~5 minutes.

### Reset steps (Steven executes)

1. **Supabase dashboard → staging project (`bjiiqnetaxoibhcaukqm`)**
   - Go to: Project Settings → General → Danger Zone
   - Click **Reset database** (not "Delete project" — reset preserves the
     project ref, connection strings, and Vercel env vars)
   - Confirm the reset. The database will be empty after ~60 seconds.

2. **GitHub Actions secrets** — add before running the workflow:
   - `STAGING_SUPABASE_PROJECT_REF` = `bjiiqnetaxoibhcaukqm`
   - `STAGING_SUPABASE_DB_PASSWORD` = the staging DB password (see §4.1)

3. **Trigger the staging migration job** (once the workflow PR is merged and
   secrets are set):
   - Either push any migration file change to main, or use
     `workflow_dispatch` on `deploy-migrations.yml` and tick
     `target_staging = true`

4. **Run the seed script:**
   ```
   SUPABASE_URL=<staging-url> SUPABASE_SERVICE_ROLE_KEY=<staging-srk> \
     npx tsx scripts/seed-staging.ts
   ```

---

## 4. Your action items before any PR can be executed

### 4.1 — Staging DB password

Location: Supabase dashboard → staging project (`bjiiqnetaxoibhcaukqm`) →
Project Settings → Database → Connection string → Direct connection →
copy the password field.

You need this for `STAGING_SUPABASE_DB_PASSWORD` (GitHub secret, §4.2).
This is NOT the service role key — it is the Postgres superuser password
used by `supabase db push` to open the management tunnel.

### 4.2 — GitHub Actions secrets

Go to: GitHub repo → Settings → Secrets and variables → Actions → New repository secret.

Add both:

| Secret name | Value |
|---|---|
| `STAGING_SUPABASE_PROJECT_REF` | `bjiiqnetaxoibhcaukqm` |
| `STAGING_SUPABASE_DB_PASSWORD` | (from §4.1) |

The existing `SUPABASE_ACCESS_TOKEN` is account-level and is reused by
the staging job — no new token needed.

### 4.3 — Vercel env (no changes needed)

The Preview environment already has `SUPABASE_URL` pointing to
`bjiiqnetaxoibhcaukqm`. No Vercel dashboard changes are required.

Optionally add `SUPABASE_DB_URL` to the Preview environment (the session-pooler
URL for the staging project) if you want `supabase db query` CLI access to
staging. Not required for the workflow to function.

---

## 5. `deploy-migrations.yml` staging job design

When the PR implementing this is ready, add a second job to
`.github/workflows/deploy-migrations.yml` immediately after the `push` job:

```yaml
  push-staging:
    name: supabase db push (staging)
    runs-on: ubuntu-latest
    needs: push          # only run if production push succeeded
    timeout-minutes: 15
    # No "environment: production" guard here — staging is not gated.
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
    steps:
      - uses: actions/checkout@v4

      - uses: supabase/setup-cli@v1
        with:
          version: latest

      - name: Verify staging secrets are set
        run: |
          missing=0
          for var in STAGING_SUPABASE_PROJECT_REF STAGING_SUPABASE_DB_PASSWORD; do
            if [ -z "${!var:-}" ]; then
              echo "::warning::Staging secret $var not set — skipping staging push."
              missing=1
            fi
          done
          if [ "$missing" = "1" ]; then
            echo "SKIP_STAGING=true" >> "$GITHUB_ENV"
          fi
        env:
          STAGING_SUPABASE_PROJECT_REF: ${{ secrets.STAGING_SUPABASE_PROJECT_REF }}
          STAGING_SUPABASE_DB_PASSWORD: ${{ secrets.STAGING_SUPABASE_DB_PASSWORD }}

      - name: Link to staging project
        if: env.SKIP_STAGING != 'true'
        run: supabase link --project-ref "${{ secrets.STAGING_SUPABASE_PROJECT_REF }}"

      - name: Show pending migrations (diagnostic)
        if: env.SKIP_STAGING != 'true'
        run: supabase migration list --linked || true

      - name: Push pending migrations to staging
        if: env.SKIP_STAGING != 'true'
        env:
          SUPABASE_DB_PASSWORD: ${{ secrets.STAGING_SUPABASE_DB_PASSWORD }}
        run: supabase db push --linked --include-all

      - name: Summarise on success
        if: env.SKIP_STAGING != 'true' && success()
        run: |
          {
            echo '## Staging migrations pushed'
            echo
            supabase migration list --linked 2>&1 | sed -e 's/\x1b\[[0-9;]*m//g'
          } >> "$GITHUB_STEP_SUMMARY"
```

**Key design decisions:**

- `needs: push` — staging only runs if production succeeded. Never push to
  staging while production is broken.
- Secrets are checked with a soft warning, not a hard fail — if the staging
  secrets are not yet set, the staging job skips cleanly rather than blocking
  the production push.
- No `environment: production` guard on the staging job — staging pushes do
  not require manual approval.
- Same `--include-all` flag — consistent with the production job; idempotent
  on already-applied migrations.
- `concurrency: group: deploy-migrations` on the parent workflow already
  serialises all runs, so no separate concurrency group is needed for the
  staging job.

---

## 6. `scripts/seed-staging.ts` specification

Run once after the fresh reset + full migration push. Idempotent — safe to
re-run (upserts, not inserts).

### Prod-guard (mandatory — must be first lines of the script)

```typescript
const url = process.env.SUPABASE_URL ?? "";
const PROD_REF = "sazapxgmrdaewrkwoxby";
if (url.includes(PROD_REF)) {
  throw new Error(
    `ABORT: SUPABASE_URL points to the production project (${PROD_REF}). ` +
    `This script must never run against production.`
  );
}
if (!url) {
  throw new Error("SUPABASE_URL is not set.");
}
```

### Seed personas

| Email | Role (`opollo_users`) | `is_opollo_staff` | Company |
|---|---|---|---|
| `steven.m@opollo.com` | `super_admin` | `true` | — |
| `uat-bot@staging.opollo.com` | `admin` | `true` | — |
| `test-member@staging.opollo.com` | `user` | `false` | staging-test-co |

Passwords: generated by the script, printed once to stdout in a table. The
script does not store them. Re-running regenerates new passwords for any
persona whose auth row doesn't already exist.

### Seed steps

1. `supabase.auth.admin.createUser` for each persona with `email_confirm: true`
   (skip if user already exists by email lookup).
2. Upsert `opollo_users` row (`on_conflict=id`).
3. Upsert `platform_users` row (`on_conflict=id`).
4. Create one `platform_companies` row named `"Staging Test Co"` if it doesn't
   exist.
5. Add `test-member@staging.opollo.com` to that company as role `admin`.
6. Insert one `feedback_ticket` (status `backlog`, severity `normal`) so the
   admin feedback board is not empty.

### Invocation

```bash
SUPABASE_URL=https://bjiiqnetaxoibhcaukqm.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<staging-service-role-key> \
  npx tsx scripts/seed-staging.ts
```

Never add `SUPABASE_URL` for the staging project to `.env.local` —
that would risk local dev accidentally hitting staging. Pass it inline
or export only in a terminal session where you intend to seed.

---

## 7. Isolation confirmation

Staging and production are already fully isolated at the infrastructure level:

- **Separate Postgres instances** — different Supabase projects, no shared
  tables, no cross-project foreign keys.
- **Separate auth stores** — `auth.users` is per-project. A staging user
  cannot log in to production and vice versa.
- **Separate storage buckets** — `feedback-screenshots` and
  `social-media-uploads` buckets are per-project.
- **Vercel env segregation** — Production reads `SUPABASE_URL` from the
  Vercel `Production` environment; Preview reads from the Vercel `Preview`
  environment. These are separate encrypted values pointing to separate project
  refs. Confirmed 2026-06-05.

**Remaining risk to watch:** the `deploy-migrations.yml` staging job must
reference `STAGING_SUPABASE_PROJECT_REF` and `STAGING_SUPABASE_DB_PASSWORD`
as distinct secrets from `SUPABASE_PROJECT_REF` and
`PRODUCTION_SUPABASE_DB_PASSWORD`. They must never share the same secret name.
A typo in the workflow referencing the wrong secret name would push migrations
to the wrong project.

---

## 8. Environment reference table (target state after this plan executes)

| Dimension | Local | Staging | Production |
|---|---|---|---|
| Supabase project | Docker (`supabase start`) | `bjiiqnetaxoibhcaukqm` | `sazapxgmrdaewrkwoxby` |
| Vercel target | — | `Preview` + `Development` | `Production` |
| Migrations land via | `supabase db push` manually | `deploy-migrations.yml` `push-staging` job | `deploy-migrations.yml` `push` job |
| Trigger | Manual | Merge to `main` touching `supabase/migrations/**` | Same |
| Auth users | Local seed | `scripts/seed-staging.ts` | Real users |
| Data | Ephemeral | Test fixtures only | Live client data |
| Service role key secret | `.env.local` (gitignored) | Vercel `Preview` env | Vercel `Production` env |
| DB password secret | Local Supabase default | `STAGING_SUPABASE_DB_PASSWORD` (GitHub) | `PRODUCTION_SUPABASE_DB_PASSWORD` (GitHub) |
| Project ref secret | N/A | `STAGING_SUPABASE_PROJECT_REF` (GitHub) | `SUPABASE_PROJECT_REF` (GitHub) |

---

## 9. Execution checklist (in order)

- [ ] **Steven**: Get staging DB password from Supabase dashboard (§4.1)
- [ ] **Steven**: Add `STAGING_SUPABASE_PROJECT_REF` to GitHub Actions secrets (§4.2)
- [ ] **Steven**: Add `STAGING_SUPABASE_DB_PASSWORD` to GitHub Actions secrets (§4.2)
- [ ] **Steven**: Reset staging DB from Supabase dashboard (§3, step 1)
- [ ] **Agent**: Open PR with `deploy-migrations.yml` staging job (§5) + `scripts/seed-staging.ts` (§6)
- [ ] **Steven**: Review and merge that PR
- [ ] **Agent/Steven**: Trigger `deploy-migrations.yml` with `workflow_dispatch` to push all 184 migrations to staging
- [ ] **Steven**: Verify migration list in the workflow summary shows all 184 applied
- [ ] **Agent/Steven**: Run `scripts/seed-staging.ts` to seed test users
- [ ] **Steven**: Log in to the preview deployment as `steven.m@opollo.com` and smoke-test
