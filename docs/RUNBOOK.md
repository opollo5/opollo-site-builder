# Opollo Site Builder — Runbook

Operational playbook for the live site. Intended for the on-call operator (currently: Steven) when something breaks at 2 am.

Every entry has the same shape:

- **Symptom** — what you'll see first.
- **Impact** — who's affected and how badly.
- **Diagnose** — where to look, what to run.
- **Mitigate** — fastest path to stop the bleeding (break-glass, kill switch, rollback).
- **Resolve** — the actual fix.

Keep this file terse. If a section grows past a screen, split it out.

---

## Quick reference — break-glass controls

| Control | What it does | How to trigger |
| --- | --- | --- |
| `opollo_config.auth_kill_switch = 'on'` | Middleware falls back to HTTP Basic Auth (bypasses Supabase Auth entirely). | `POST /api/emergency` with `OPOLLO_EMERGENCY_KEY` + body `{"action":"kill_switch_on"}`. |
| `opollo_config.auth_kill_switch = 'off'` (or row absent) | Restores normal Supabase Auth flow. | Same endpoint, `{"action":"kill_switch_off"}`. |
| Revoke all sessions for one user | Invalidates refresh tokens + bans the user in `auth.users`. | `POST /api/admin/users/[id]/revoke` (admin required). Break-glass alt: `POST /api/emergency {"action":"revoke_user","user_id":"<uuid>"}`. |
| Reset a locked-out admin's password | Sets a new password on `auth.users` directly via service-role. Does NOT revoke existing sessions. | `POST /api/ops/reset-admin-password` with `OPOLLO_EMERGENCY_KEY` + body `{"email":"<admin email>","new_password":"<new>"}`. |
| Cancel in-flight batch | Stops pending slots from leasing; in-flight slots finish but don't flip status back. | `POST /api/admin/batch/[id]/cancel` (creator or admin). |
| Rollback deploy | Re-tag the last known-good commit. | `vercel rollback <deployment-url>` or promote a prior deployment in the Vercel dashboard. |

---

## Deploy rollback

**Symptom:** new deploy introduced a regression.

**Impact:** scope depends on the regression. Assume worst case — operator work blocked or end-users seeing errors.

**Diagnose:**
1. Hit `/api/health` — 200 means the runtime is alive, 503 means Supabase unreachable. Do NOT rollback before confirming the app (not the DB) is at fault.
2. Check Vercel deployment logs for the current and previous deploys.
3. Compare `git log` between the current main and the previous tagged release.

**Mitigate:**
- In the Vercel dashboard, open the Deployments list, find the last green deploy, click "Promote to Production." This is the ~30 s path.
- Alternative via CLI: `vercel rollback <prev-deployment-url>`.

**Resolve:**
- Open a revert PR on main for the offending commit(s): `git revert <sha> && git push`.
- Close the loop: CI runs, Vercel promotes the reverted build to production.

---

## Auth is broken (login loop, 500s on admin routes)

**Symptom:** signing in loops back to /login, or admin routes return 500 `AUTH_UNAVAILABLE`.

**Impact:** all admin work blocked. End users unaffected (no end-user surface yet).

**Diagnose:**
1. Check Supabase Auth status at the Supabase dashboard (status.supabase.com too).
2. Hit `/api/health` — 503 with `supabase_error` surfaces the exact error.
3. Confirm `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set in Vercel project env vars.

**Mitigate:** flip the kill switch.

```bash
curl -X POST https://opollo.vercel.app/api/emergency \
  -H "Authorization: Bearer $OPOLLO_EMERGENCY_KEY" \
  -H "content-type: application/json" \
  -d '{"action":"kill_switch_on"}'
```

Middleware now runs HTTP Basic Auth (set `BASIC_AUTH_USER` + `BASIC_AUTH_PASSWORD` in Vercel if not already). No Supabase Auth calls are made.

**Resolve:**
- Supabase outage → wait for upstream recovery, then flip kill switch off.
- Misconfigured env var → fix in Vercel, trigger a redeploy, confirm `/api/health` is green, flip kill switch off.

---

## Supabase Auth URL configuration — required dashboard settings (M14-2)

**Symptom:** password-reset / invite / magic-link emails land with a callback URL pointing at `localhost:3000` or a preview deploy instead of production; clicking the link lands the user on "Site can't be reached" or redirects to the wrong host.

**Impact:** affected users (anyone receiving an email-driven auth link from prod) cannot complete the auth flow.

**Why this needs a manual dashboard step:** the Supabase dashboard's **Site URL** + **Redirect URLs** allowlist are the authoritative values Supabase Auth consults when it sends an email. Code-side `redirectTo` is only honoured if it matches an entry in the allowlist; the Site URL is used as a fallback default when no redirectTo is supplied. Neither can be set via environment variables or the Supabase CLI — they live exclusively in the dashboard. This is the one configuration that code cannot fix.

**Diagnose:**
1. In the Supabase dashboard, navigate to **Authentication → URL Configuration**.
2. Read the current **Site URL** value. If it's `http://localhost:3000` or any non-production URL, that is the bug.
3. Read the **Redirect URLs** allowlist. Production callback URL must be present.

**Apply (production project):**

In **Authentication → URL Configuration**:

| Field | Value |
| --- | --- |
| Site URL | `https://opollo.vercel.app` (or whatever the canonical production URL is — match `NEXT_PUBLIC_SITE_URL` in Vercel env) |
| Redirect URLs allowlist | one entry per environment that sends auth emails. See list below. |

**Redirect URLs allowlist entries:**

```
https://opollo.vercel.app/api/auth/callback
https://opollo.vercel.app/auth/reset-password
https://opollo.vercel.app/auth/forgot-password
https://*-opollo.vercel.app/api/auth/callback
https://*-opollo.vercel.app/auth/reset-password
https://*-opollo.vercel.app/auth/forgot-password
http://localhost:3000/api/auth/callback
http://localhost:3000/auth/reset-password
http://localhost:3000/auth/forgot-password
```

- First block: production. Required for every email sent to a real user.
- Second block: Vercel preview deploys. The `*-opollo.vercel.app` wildcard covers every branch-preview URL.
- Third block: local dev. Only needed if a developer tests email flows against the production Supabase project (not typical — local dev should use local Supabase).

The `/auth/reset-password` and `/auth/forgot-password` entries are forward-looking — those routes land with M14-3. Registering them now means M14-3 doesn't need another dashboard trip.

**Corresponding env var (set in Vercel):**

`NEXT_PUBLIC_SITE_URL=https://opollo.vercel.app` on Vercel production. Preview + dev can leave it unset; the helper falls back to the request origin.

**Verify:**
1. Trigger one auth email from production (e.g. invite a throwaway email via `/admin/users` or hit `/auth/forgot-password` with a real admin email).
2. Receive the email. The link's host must be `opollo.vercel.app`, not `localhost:3000`.
3. Click it. It must land on the intended Opollo route, not on a Supabase error page saying "Invalid redirect URL."

If a click lands on "Invalid redirect URL," the clicked URL wasn't in the allowlist. Add it and retry.

**Resolve:** once the dashboard values are correct + the env var is set on Vercel production, the app's `lib/auth-redirect.ts` helper and every caller of it (invite route today, forgot-password + reset-password in M14-3) produce URLs that match the allowlist, and Supabase sends the correct host in emails. No redeploy needed after a dashboard change — the new values take effect on the next auth email.

---

## Admin locked out — reset an admin password (M14-1)

**Symptom:** an admin account (`hi@opollo.com`, any other `role='admin'` user) can't sign in and the self-service password-reset email is not usable — email not delivered, redirect misconfigured, Supabase auth email flow down.

**Impact:** the affected admin is locked out. Other admins unaffected.

**Diagnose:**
1. Confirm the account exists in `opollo_users` with `role='admin'` and `deleted_at IS NULL`.
2. Confirm `OPOLLO_EMERGENCY_KEY` is set in the target environment (Vercel production env for a prod reset; `.env.local` for dev).
3. Confirm Supabase itself is reachable — `/api/health` should be 200. If Supabase is down, this tool will 500 because it calls `supabase.auth.admin.updateUserById` under the hood. In that case the fix is to restore Supabase first.

**Mitigate:** hit the reset endpoint with the emergency key. Pick a strong throwaway password (≥12 chars); the admin rotates it via `/account/security` once logged in (M14-4, not yet shipped — until then, run this endpoint again to rotate).

```bash
curl -X POST https://opollo.vercel.app/api/ops/reset-admin-password \
  -H "Authorization: Bearer $OPOLLO_EMERGENCY_KEY" \
  -H "content-type: application/json" \
  -d '{"email":"hi@opollo.com","new_password":"<strong-temp-password>"}'
```

Expected: `{"ok":true,"data":{"email":"...","user_id":"..."}}`. Sign in with the new password immediately and rotate it.

**Guards the endpoint enforces:**
- Key missing or <32 chars → 503 `EMERGENCY_NOT_CONFIGURED`.
- Wrong key → 401 `UNAUTHORIZED` (constant-time compare).
- Target not in `opollo_users` → 404 `NOT_FOUND`.
- Target has `role != 'admin'` → 403 `FORBIDDEN`. This endpoint is admin-only — emergency-key compromise must not become a full tenant takeover. Use `POST /api/emergency {"action":"revoke_user"}` for non-admin intervention instead.
- Password shorter than 12 chars → 400 `VALIDATION_FAILED`.

**Resolve:**
- After every successful reset, consider whether the emergency key has itself been compromised (who ran the command, were they authorised, was the key transmitted over a safe channel). If in doubt, rotate `OPOLLO_EMERGENCY_KEY` per "Rotate a secret" below.
- This endpoint does NOT revoke existing sessions. If the lock-out is suspected compromise rather than a forgotten password, chain it with `POST /api/emergency {"action":"revoke_user","user_id":"<uuid>"}` to kill every session for the user.

---

## Batch generator stuck

**Symptom:** a generation job has been in `status='processing'` for > 10 min without completing; slots lingering in `leased`.

**Impact:** specific batch blocked. Other batches, admin UI, and manual site edits keep working.

**Diagnose:**
1. Query the job: `SELECT id, status, succeeded_count, failed_count, requested_count FROM generation_jobs WHERE id = '<uuid>';`
2. Inspect slot state: `SELECT state, count(*) FROM generation_job_pages WHERE job_id = '<uuid>' GROUP BY state;`
3. Look for expired leases: `SELECT id, worker_id, lease_expires_at FROM generation_job_pages WHERE job_id = '<uuid>' AND state='leased' AND lease_expires_at < now();`
4. Check `generation_events` for the last event per slot: `SELECT slot_id, max(created_at) FROM generation_events WHERE job_id='<uuid>' GROUP BY slot_id;`

**Mitigate:**
- If nothing is truly in-flight (all leases expired), the reaper should reset them on the next cron tick. The Vercel cron runs every minute — wait one cycle.
- If work must stop now: `POST /api/admin/batch/<id>/cancel`. Pending slots flip to `skipped`, in-flight slots complete but don't move the job status.

**Resolve:**
- A runaway reaper loop means an Anthropic or WP API that's consistently timing out. Check `generation_events` for a burst of `anthropic_error` or `wp_publish_error` with the same code. Either pause billing / retry budget raising is in scope, or the batch was misconfigured (wrong template, stale design_system).
- Post-mortem: update the retry budget or the template, rerun the job with a fresh idempotency_key (the old one is spent).

---

## WordPress publish failures

**Symptom:** slots going `failed` with `WP_API_NON_RETRYABLE` or piling up in `retry_after` windows.

**Impact:** new pages don't land on the client WP site. Previously-published pages unaffected.

**Diagnose:**
1. `SELECT failure_code, count(*) FROM generation_job_pages WHERE job_id='<uuid>' GROUP BY failure_code;`
2. Inspect `generation_events` of type `wp_publish_error` for the full WP response.
3. Hit the WP REST API manually: `curl -u '<user>:<app-password>' '<wp_url>/wp-json/wp/v2/pages?per_page=1'`.

**Mitigate:**
- If WP is fully down: cancel the batch so slots stop retrying and burning Anthropic cost.
- If the app password rotated: update `sites.wp_app_password` (encrypted column) via the Edit Site modal. New batches pick up the fresh creds; in-flight batches retry on the next tick.

**Resolve:**
- Confirm WP plugin / Jetpack isn't blocking REST writes.
- Confirm `LEADSOURCE_WP_URL` (or the site's `wp_url`) is the exact REST-API origin, not a www-redirected host.
- If the slot is adoption-capable (fresh WP post with same slug), the next retry will GET-first and update in place.

---

## Supabase out of row budget / cost spike

**Symptom:** Supabase dashboard alert, or `/api/health` times out.

**Impact:** writes start failing; reads may keep working.

**Diagnose:**
1. Supabase dashboard → Reports → row count, storage, egress.
2. Largest tables: `SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 10;`
3. `generation_events` is the historical bloat candidate — append-only, not pruned. Check row count first.

**Mitigate:** nothing remote-wipeable; consider rate-limiting new batches.

**Resolve:**
- If `generation_events` is huge: archive events older than N days into a cheap store, then DELETE in batches of 10 000 with a vacuum.
- If `pages.html` is huge: deduplicate or compress. (Not currently chunked; follow-up slice.)

---

## Security incident — suspected key leak

**Symptom:** gitleaks alert on a commit, or unfamiliar sign-ins in Supabase audit logs.

**Impact:** severity-dependent. Treat the key as compromised until proven otherwise.

**Diagnose:**
1. Which key: `SUPABASE_SERVICE_ROLE_KEY`, `OPOLLO_MASTER_KEY`, `OPOLLO_EMERGENCY_KEY`, `CRON_SECRET`, or a WP app password?
2. Where: commit history (`git log -S '<secret prefix>'`), Vercel env vars, client cookies, CI logs.

**Mitigate:** rotate immediately.

- `SUPABASE_SERVICE_ROLE_KEY` → Supabase dashboard → Settings → API → Reset service role key. Update Vercel env, redeploy.
- `OPOLLO_MASTER_KEY` → generate new key (`openssl rand -base64 32`), freeze writes that touch `sites.wp_app_password`, re-encrypt every `site_credentials` row with the new key via an ad-hoc script (`lib/encryption.ts` currently reads a single active key — no `_NEXT` dual-key fallback today), swap the env var in Vercel, redeploy, unfreeze. Details in the "OPOLLO_MASTER_KEY (encrypts `sites.wp_app_password`)" section below. Dual-key zero-downtime rotation is a backlog item.
- `OPOLLO_EMERGENCY_KEY` → regenerate (`openssl rand -base64 48`), update Vercel, redeploy. No data re-encrypt needed.
- `CRON_SECRET` → regenerate, update Vercel + Vercel cron config, redeploy.
- WP app password → generate a new one in WP admin, update via Edit Site modal.

**Resolve:**
- Revoke all active Supabase Auth sessions (`POST /api/emergency {"action":"revoke_user","user_id":"<uuid>"}` per admin, or broader sweep via service-role admin API).
- Scrub the key from git history if it was ever committed (`git filter-repo` — plan carefully; rewrites history for every contributor).
- Open a retrospective issue with the root cause and the prevention (add to `.gitleaks.toml` allow-list only if the string is genuinely a safe fixture).

---

## Apply pending migrations to production

**Symptom:** `/api/health` reports `supabase_error` mentioning a missing column / table / policy, OR a freshly-deployed code path throws `column "X" does not exist`.

**Impact:** routes that touch the new schema are broken. Other routes keep working.

**Diagnose:**
1. `supabase migration list --db-url "$DATABASE_URL"` against the production DB URL. Compare the applied list to `supabase/migrations/`.
2. The set of pending migrations is what needs to be applied.
3. Check `.github/workflows/deploy-migrations.yml` run history — if the workflow failed silently on the merge commit, that's the gap.

**Mitigate:** fall back to Basic Auth via the kill switch if the missing migration is auth-related:

```bash
curl -X POST "$APP_URL/api/emergency" \
  -H "Authorization: Bearer $OPOLLO_EMERGENCY_KEY" \
  -H "content-type: application/json" \
  -d '{"action":"kill_switch_on"}'
```

For a missing feature-path migration: disable the relevant `FEATURE_X` in Vercel env and redeploy.

**Resolve:**
1. Pull the production `DATABASE_URL` from Supabase dashboard → Connect → Direct Connection.
2. `supabase db push --db-url "$DATABASE_URL" --include-all` applies every pending migration in order.
3. Confirm: `supabase migration list --db-url "$DATABASE_URL"` shows all local migrations as applied remote.
4. Re-enable the flag + flip the kill switch off.
5. Re-check `/api/health` → 200 ok.

**Post-mortem:**
- Why did the automated workflow miss it? Failing silently is the real bug — fix the workflow, not just the database.
- If the migration contained a destructive step (`DROP COLUMN`, `DROP CONSTRAINT`), confirm no data loss against a recent Supabase backup.

### Apply a backfill-required migration to a populated production DB

Some shipped migrations add columns without `NOT NULL DEFAULT`; on a fresh DB this is fine, but applying against a production DB with existing rows requires a backfill. Audit 3 flagged `supabase/migrations/0008_m3_4_slot_html.sql` and `0009_m3_7_retry_after.sql` as examples — both add columns to `generation_job_pages` with no default and no backfill step. At the time they shipped, every production row was empty (M3 was the first milestone to populate the table), so there was no gap. Going forward, any migration that adds a column to a populated table MUST either supply `NOT NULL DEFAULT <value>` or include an explicit backfill.

**When diagnosing a failed live-DB upgrade with `ERROR:  column "X" contains null values` or `ERROR: ... violates not-null constraint`:**

1. Identify the migration file. Confirm it is the cause (check the error line number + the SQL near the ADD COLUMN / ALTER COLUMN).
2. Run the backfill BEFORE the migration, in the same transaction window:
   ```sql
   BEGIN;
   UPDATE <table> SET <new_column> = <safe_default> WHERE <new_column> IS NULL;
   ALTER TABLE <table> ALTER COLUMN <new_column> SET NOT NULL;
   COMMIT;
   ```
   `<safe_default>` depends on the column's semantics — zero for usage counters, `'pending'` for status enums, NULL-safe sentinel values for timestamps. Check the migration's comment header for the author's intent.
3. Re-run the forward migration. It will no-op the `ALTER COLUMN ... NOT NULL` step and succeed.
4. Record the incident — a follow-up migration should codify the backfill so future fresh-DB runs produce the same data shape.

**Prevention going forward.** New `ALTER TABLE ... ADD COLUMN` migrations targeting populated tables MUST specify `NOT NULL DEFAULT <value>` or include an explicit backfill step in the same migration file. Reviewers should catch this during PR review; the CLAUDE.md write-safety-audit section covers the pattern. If in doubt, the safer path is a two-migration sequence: first add the column nullable with a backfill data-migration, then a follow-up migration flips it to NOT NULL once the backfill is verified in production.

---

## Rotate a secret

**Symptom:** scheduled rotation, suspected leak, or compliance requirement. Known secrets in play: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `OPOLLO_MASTER_KEY`, `OPOLLO_EMERGENCY_KEY`, `CRON_SECRET`, `ANTHROPIC_API_KEY`, each site's `wp_app_password`.

**Impact:** during the rotation window, any service using the old value fails. Most rotations can be staged to avoid downtime.

### SUPABASE_SERVICE_ROLE_KEY

1. Supabase dashboard → Settings → API → "Reset service role key." This invalidates the old key immediately.
2. Copy the new key into Vercel env (all environments).
3. `vercel redeploy --prod` — or wait for the next merge.
4. Confirm `/api/health` → 200. If 503 with `supabase_error` mentioning auth, the new key didn't propagate; re-check Vercel env.

**Downtime window:** ~30s between reset and Vercel redeploy. Schedule outside peak.

### OPOLLO_MASTER_KEY (encrypts `sites.wp_app_password`)

`lib/encryption.ts` reads a single active key. Rotation requires a write-freeze on `sites.wp_app_password` while every `site_credentials` row is re-encrypted. The `key_version` column on `site_credentials` is in place for a future dual-key zero-downtime path, but the code does not read `OPOLLO_MASTER_KEY_NEXT` today — do not rely on staging a `_NEXT` variable to run in parallel with the old key.

1. `openssl rand -base64 32` → new key. Record it in the password manager.
2. Freeze writes that touch `sites.wp_app_password`:
   - Confirm no active batch: `SELECT count(*) FROM generation_jobs WHERE status IN ('queued','running');` must be 0. Wait for stragglers or cancel via `POST /api/admin/batch/[id]/cancel`.
   - Pause the relevant Vercel crons (batch, transfer, regeneration).
   - Turn on the auth kill switch to block admin UI writes: `POST /api/emergency` with `{"action":"kill_switch_on"}` (see the admin-reset section of this runbook for the curl shape).
3. Re-encrypt every `site_credentials` row with the new key. Today this is an ad-hoc script run from a trusted machine (not committed): for each row, decrypt `site_secret_encrypted` with the old key, re-encrypt with the new key, write back the new ciphertext + fresh `iv` + bumped `key_version`, atomically per row (`UPDATE ... WHERE id = $1 RETURNING key_version`). Run against a staging clone of the row set first to verify.
4. Swap the key in Vercel: `OPOLLO_MASTER_KEY` = new key. Redeploy.
5. Unfreeze: `POST /api/emergency` with `{"action":"kill_switch_off"}`, resume crons.
6. Confirm: in the admin UI, Edit Site → Save on one site. The round-trip must succeed (app decrypts with new key + re-encrypts back).

**Downtime window:** the write-freeze — at current scale (<5 sites) that is seconds, not minutes. If rotation cadence becomes routine or the site count grows materially, invest in the dual-key code path (`lib/encryption.ts` accepts a staged `OPOLLO_MASTER_KEY_NEXT` and tries both on decrypt). That is a backlog item, not the current procedure. Do not follow an older version of this runbook that describes a zero-downtime `_NEXT` flow — the code does not support it.

### OPOLLO_EMERGENCY_KEY

1. `openssl rand -base64 48` — new key.
2. Update Vercel env `OPOLLO_EMERGENCY_KEY`. Redeploy.
3. Update the operator's password manager + `docs/RUNBOOK.md` break-glass commands with the new key.
4. Test: call `POST /api/emergency` with the new key + a no-op body (`{"action":"kill_switch_off"}` when it's already off). Expect 200.

**Downtime window:** 30s. The break-glass path is unusable during the window; avoid rotating during an active incident.

### CRON_SECRET

1. `openssl rand -base64 32` — new value.
2. Update Vercel env `CRON_SECRET`.
3. Vercel dashboard → Project → Cron Jobs → update the `Authorization: Bearer` header (if stored there; otherwise the cron sends `CRON_SECRET` automatically).
4. Redeploy.
5. Wait one tick (60s). Confirm `/api/cron/process-batch` run fires successfully. Cron log should show 200.

**Downtime window:** one cron tick (60s). During the window the worker doesn't advance.

### ANTHROPIC_API_KEY

1. Anthropic console → API keys → Rotate.
2. Update Vercel env. Redeploy.
3. Check a batch: create a dummy 1-slot batch + watch it reach `state='succeeded'` in `generation_job_pages`.

**Downtime window:** in-flight Anthropic calls keyed to the old key fail once. The retry loop picks them up automatically on the next tick.

### WP app password (per site)

1. WP admin → Users → Profile → Application Passwords → generate new.
2. In the admin UI, Edit Site → update password. The app re-encrypts with `OPOLLO_MASTER_KEY`.
3. Test: trigger a small batch or a manual WP publish on that site. Expect 200 from WP.

**Downtime window:** any in-flight publish to that site fails once. Retries use the new password.

**Always:**

- After any rotation, grep git history for the old value (`git log -S '<prefix>'`) to confirm it was never committed.
- Update `.gitleaks.toml` if the new value happens to match any false-positive rule.
- Log the rotation in a lightweight log (spreadsheet / ops channel) so the next rotation cadence is tracked.

---

## Provision env vars for a new observability tool

**Context.** Scaffolded vendors that need env vars to activate: Sentry, Axiom, Langfuse, Upstash Redis. Each is a graceful no-op without its envs; provisioning "flips" the tool on.

### One-time provisioning playbook

For each tool (Sentry / Axiom / Langfuse / Upstash):

1. **Create the account / project** in the vendor's dashboard. Pick the free tier where available.
2. **Copy the required env vars** from the vendor dashboard:
   - Sentry: `SENTRY_DSN`, `SENTRY_AUTH_TOKEN` (for source-map upload).
   - Axiom: `AXIOM_TOKEN`, `AXIOM_DATASET`.
   - Langfuse: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, optionally `LANGFUSE_HOST` if self-hosted (defaults to `https://us.cloud.langfuse.com`; set to `https://cloud.langfuse.com` for EU or to a custom URL for self-host).
   - Upstash: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
3. **Add them to Vercel** — Settings → Environment Variables. Set all three environments (Production, Preview, Development) unless the vendor is production-only.
4. **Add to `.env.local.example`** with a comment explaining the default-off behaviour.
5. **Redeploy production** — `vercel redeploy --prod` or an empty commit on main.
6. **Verify**: the scaffold's `isXEnabled()` check (or equivalent) now returns true. For Sentry, generate a test exception in a dev route and confirm it lands in the dashboard. For Axiom, tail the dataset for a fresh log line with the expected request_id shape. For Langfuse, run one eval and confirm the trace appears. For Upstash, confirm `/api/health` reports `redis: "ok"`.

### Batch provisioning

All four can be done in one session:

1. Create four accounts (15 min total).
2. Copy 8 env vars into Vercel.
3. Redeploy once.
4. Verify each per the above.

Log the provisioning date + vendor account IDs somewhere persistent; each rotation relies on it.

**If a vendor's quota is hit** (Axiom ingest, Sentry event cap): the logger / transport falls back gracefully per the scaffold. The app does not fail; the tool just goes quiet. Check the vendor's usage dashboard if observability signal drops unexpectedly.

---

## Diagnose a missing-migration incident

**Symptom:** typically a 500 on a specific route with a Postgres error like `column "<name>" does not exist` / `relation "<table>" does not exist` / `policy "<p>" does not exist`. `/api/health` may also go 503.

**Impact:** scope depends on which migration is missing. Auth migrations → everyone affected. Feature-path migrations → that feature only.

**Diagnose:**

1. **Confirm which migration.** The error message names the column / table / policy. Grep `supabase/migrations/` for the first place it was introduced. That's the one missing in production.
2. **Confirm the production state.**
   ```bash
   supabase migration list --db-url "$DATABASE_URL"
   ```
   This lists `Applied` + `Local`. Any migration present in `Local` but not `Applied` is pending.
3. **Check the deploy workflow.** `.github/workflows/deploy-migrations.yml` runs on merge to main. Look at the run for the merge commit that introduced the new migration. A failure there is the root cause (not the missing migration itself — the workflow is the gap).

**Mitigate:**

- If the missing migration affects auth: break-glass via kill switch (see "Auth is broken" above).
- If it affects a feature path: disable the relevant `FEATURE_X` in Vercel env and redeploy. User-facing error vanishes; the feature goes dark until the migration lands.
- If the missing migration is behind a soft rollout (e.g. Supabase Auth migration but HTTP Basic still works), no operator action needed beyond the resolve step.

**Resolve:**

1. **Fix the workflow first, migration second.** A failed run in `deploy-migrations.yml` should re-trigger on the next push. If it keeps failing, fix the workflow (env var, secret, permissions).
2. Apply the pending migrations directly (see "Apply pending migrations to production" above).
3. Verify `/api/health` 200 + the previously-broken route works.
4. Re-enable the feature flag / kill switch.

**Post-mortem:**

- Why did `deploy-migrations.yml` fail silently? Add a notification step (Slack / email) for workflow failures on main.
- Was the migration tested locally against a fresh DB before merging? `npm run test` + `supabase db reset && supabase db push` locally catches most of these.

---

## Production incident recovery

**Context.** A general-purpose entry for when production is in a bad state that doesn't match any specific entry above. Follow the sequence; escalate only when the sequence doesn't clear.

**Order of operations:**

1. **Stop the bleeding.** Decide: is this a rollback (deploy regression) or a runtime flip (feature-flag kill switch)? If both are plausible, start with the kill switch — it's reversible in 30 seconds. Rollback is reversible in five minutes.
2. **Confirm health.** `/api/health` 200 = runtime alive. 503 = infrastructure. If health is 200 and users still see errors, look at the `x-request-id` in the browser's failing response + grep the logs (Axiom once provisioned; stdout in Vercel runtime logs today).
3. **Isolate the blast radius.** Is this everyone, one customer, one route? Production bugs narrow the scope faster than general triage does.
4. **Capture state.** Screenshot the error, note the request_id, capture the affected row id(s). The post-mortem needs this; the fix probably does too.
5. **Apply the smallest fix that clears the symptom.** A one-line revert. A flag flip. A single row UPDATE (only with a peer reviewing the SQL — even in an incident).
6. **Confirm clear.** Test the affected path manually — don't trust "logs look clean." If there's an E2E spec for the path, run it locally against production.
7. **Post-mortem same day.** New entry in this RUNBOOK + new rule in `docs/RULES.md` if the incident's cause is procedural. Don't let the learning rot.

**Never do during an incident:**

- `git push --force` to main.
- `DROP TABLE`, `TRUNCATE` on a production table.
- Rotate a secret while the break-glass is active — the rotation lock-out compounds the outage.
- Fix the root cause and the symptom in the same commit. Ship the symptom fix, confirm clear, then open a separate PR for root cause.

---

## auth-capability-missing — operator can't publish a post or sync a palette

**Symptom:** publish or appearance-panel button returns a translated banner naming a missing capability. HTTP 403 with `error.code === "PREFLIGHT_BLOCKED"` and `error.details.blocker.code === "AUTH_CAPABILITY_MISSING"`. Specific capability list in `error.details.blocker.missing_capabilities`.

**Impact:** all WP-bound writes for this site are blocked — posts can't publish, palette can't sync. Reads (preflight, dry-run) still work.

**Diagnose:**
1. Look at `appearance_events` for the latest `preflight_run` row with `details.outcome = 'blocked'` — `details.blocker_code` will be `AUTH_CAPABILITY_MISSING`. Same shape lands in M13-4's posts publish path via the route's translated error envelope.
2. The capability list this code path checks is pinned in `lib/site-preflight.ts::REQUIRED_PUBLISH_CAPABILITIES` (currently `edit_posts` + `upload_files`). Palette sync needs the same plus the operator's WP user must have `manage_options` for the `/wp/v2/settings` write — that's checked at write-time, not preflight, so a missing `manage_options` surfaces as `WP_API_ERROR` 401 from the sync route, not a preflight blocker.
3. Cross-reference the actual capability list against what WP returned: hit `/wp-json/wp/v2/users/me?context=edit` with the stored app password. The `capabilities` map is the truth.

**Mitigate:**
- No mitigation — the operator's WP user genuinely lacks the capability; there's no Opollo-side fix.

**Resolve:**
- Operator promotes the WP user to Editor (or Administrator if `manage_options` is needed) in WP Admin → Users.
- Operator regenerates the app password (the old one belongs to the prior role's session in some WP versions) in WP Admin → Profile → Application Passwords.
- Operator updates Opollo's stored credential via the Edit Site modal — `sites.site_credentials.wp_app_password` (encrypted column) is rewritten.
- Re-run preflight from the Appearance panel or the post detail page; blocker should clear.

---

## rest-disabled — WP REST returns 404 on /users/me or /themes

**Symptom:** preflight banner with `error.details.blocker.code === "REST_UNREACHABLE"`. Operator-facing copy: "WordPress REST is unreachable. The /wp-json/wp/v2/users/me endpoint returned 404."

**Impact:** every Opollo write to this site is blocked. Detection, sync, publish, unpublish, posts admin — all gated by preflight.

**Diagnose:**
1. `curl '<wp_url>/wp-json/'` from a developer machine — if 404, REST is disabled site-wide. If 200 but `/wp-json/wp/v2/users/me` 404s, REST is partially blocked (security plugin scoping).
2. Common causes: iThemes Security's "Disable XML-RPC + REST" feature, WP Hide plugin's REST URL rewrite, Cloudflare WAF rule blocking `/wp-json/*`, an override `.htaccess` rule, or a defunct `rest_authentication_errors` filter in `functions.php`.

**Mitigate:**
- No Opollo-side mitigation; operator must restore REST.

**Resolve:**
- Operator disables the REST-blocking plugin or rule:
  - iThemes Security → Settings → Tweaks → "REST API" set to "Default Access".
  - WP Hide → Rewrite → restore default `/wp-json/` path.
  - Cloudflare → WAF → exclude `/wp-json/*` from any blocking rule.
  - `.htaccess` — remove any `RewriteRule ^wp-json/`.
- Re-run preflight. The blocker should flip to `REST_AUTH_FAILED` (if creds wrong) or clear entirely.

---

## seo-plugin-missing — post publish blocked because brief declared SEO meta

**Symptom:** post publish gated by a quality-gate failure naming a missing SEO plugin. Operator sees a translated banner: "This post's brief declared SEO meta but no compatible plugin (Yoast / RankMath / SEOPress) is detected on the site."

**Impact:** the specific post can't publish. Other posts on the same site still publish if their briefs don't declare SEO meta.

**Diagnose:**
1. `lib/seo-plugin-detection.ts` fingerprints the active SEO plugin from `/wp-json/` namespace listing. If the post's brief declared `yoast.*` / `rank_math.*` / `seo_press.*` meta keys, M13-3's post quality gate enforces presence.
2. Hit `/wp-json/` and look for `wp/v2/types/post` schema fields — Yoast, RankMath, and SEOPress all expose meta fields under a recognizable namespace (`yoast_head_json`, `rank_math_meta`, `_seopress_*`).
3. Check the brief's source for declared SEO meta — currently exposed via `briefs.brand_voice` / `briefs.design_direction` content; structured SEO meta declaration is BACKLOG.

**Mitigate:**
- Operator can publish without the SEO meta by editing the brief to remove the SEO directive, then re-running. The post will publish without those meta fields.

**Resolve:**
- Operator installs one of: Yoast SEO, Rank Math, SEOPress (Steven's preference order: RankMath → Yoast → SEOPress, all free-tier).
- Operator activates the plugin in WP Admin → Plugins.
- Re-run preflight from the post detail page; gate should clear.
- Long term: brief authors should declare which SEO plugin they're targeting upfront so Opollo can preflight at brief-commit time, not publish time. BACKLOG.

---

## kadence-customizer-drift — palette sync hits WP_STATE_DRIFTED

**Symptom:** Appearance panel sync confirm hits 409 `WP_STATE_DRIFTED`. Banner: "WordPress changed between your preview and confirm. We've refreshed the diff — review again before syncing." Diff table shows different "current" colors than the operator saw 30 seconds ago.

**Impact:** sync is blocked but no data loss. Operator's intent is preserved; they need to re-review against the new state.

**Diagnose:**
1. The drift hash in `lib/kadence-palette-sync.ts::hashPalette` re-reads WP's current palette right before the write. A mismatch with the dry-run's hash triggers the failure.
2. Common cause: operator (or another team member) opened WP Admin → Customizer → Global Colors and saved a change between Opollo's dry-run and confirm.
3. Check `appearance_events` for the latest `globals_failed` row with `details.stage = 'drift_check'` — `details.expected_sha` vs `details.actual_sha` confirms the hash mismatch happened at confirm-time.

**Mitigate:**
- The route automatically re-runs preflight on `WP_STATE_DRIFTED` and surfaces the fresh diff. Operator decides:
  - Keep their Customizer edits → close the panel without syncing; Opollo's stored DS palette remains source of truth, but Customizer wins for now.
  - Override Customizer with DS → confirm the new diff (which now reflects the Customizer edits as "current"); sync overwrites them.

**Resolve:**
- The drift signal is the system working as designed — operator-visible alert prevents silent overwrite.
- If frequent drift is a workflow problem (multi-author teams stomping each other), the long-term fix is the parent plan's deferred merge-aware sync. BACKLOG candidate alongside the typography+spacing slice.

---

## stuck-brief-run — brief_run row not advancing past 'running'

**Symptom:** Run surface shows a page in `generating` for longer than the lease window (default 60s). Operator clicks Re-check; status doesn't change. Cron logs may show "lease still held by worker_id=X".

**Impact:** that specific brief is paused. Other briefs on the site continue running normally.

**Diagnose:**
1. `SELECT id, status, worker_id, lease_expires_at, last_heartbeat_at FROM brief_runs WHERE brief_id='<uuid>';` — if `lease_expires_at < now()`, the lease should be reaped on the next cron tick (every minute via `vercel.json`).
2. `SELECT id, event, details, created_at FROM brief_runs_events WHERE brief_run_id='<uuid>' ORDER BY created_at DESC LIMIT 20;` shows lease/heartbeat history.
3. Check Vercel cron logs for `process-brief-runner` — if cron is silent, the schedule is broken (verify `vercel.json` deployed and `CRON_SECRET` is set).

**Mitigate:**
- Manual reaper — under CAS, reset the row:
  ```sql
  UPDATE brief_runs
     SET status = 'queued',
         worker_id = NULL,
         lease_expires_at = NULL,
         updated_at = now(),
         version_lock = version_lock + 1
   WHERE id = '<uuid>'
     AND version_lock = <current_lock>;
  ```
  Next cron tick will lease it cleanly.
- If the row is genuinely corrupt (page state diverged from run state), cancel the run from the UI and re-upload the brief.

**Resolve:**
- Most stuck-run cases are cron-schedule problems — verify `vercel.json` includes `/api/cron/process-brief-runner` and `CRON_SECRET` is provisioned in the Vercel project. CRON-related diagnostics live in M12-6's runner cron entry.
- If the worker_id is from a deploy that's been replaced, the new deploy's cron picks up the lease via `FOR UPDATE SKIP LOCKED` once `lease_expires_at` passes. No action needed.

---

## orphan-post-row — brief_page approved but no posts row created

**Symptom:** brief_page status=approved with non-null draft_html, but `/admin/sites/[id]/posts` doesn't show the post. `approveBriefPage`'s response included `failed_bridge_reason` non-null when the operator clicked Approve.

**Impact:** the brief generation succeeded; the post is "stuck" between brief_page and posts table — operator can't publish it from the posts admin because there's no post row.

**Diagnose:**
1. The bridge in `lib/brief-runner.ts::bridgeApprovedPageToPostIfNeeded` logs `failed_bridge_reason` on every soft failure. Look at the approve route response (network tab on the Approve button click) for the `failed_bridge_reason` field. Common values:
   - `slug_already_in_use` — another live post on the site already has this slug. UNIQUE violation on `posts(site_id, slug)`.
   - `existing_lookup_failed` / `insert_failed` — Supabase write error; check supabase logs.
   - `brief_lookup_failed` — brief vanished (soft-delete race).
2. `SELECT id, slug, deleted_at FROM posts WHERE site_id='<uuid>' AND slug='<derived-slug>';` — if a row exists but with a different brief origin, the slug collision is real.
3. The slug derivation: `slug_hint` if non-null on the brief_page, else `slugify(title)`. The slugify shape is in `lib/brief-runner.ts::slugifyForPost`.

**Mitigate:**
- Operator manually creates the post via `lib/posts.createPost` from a one-off script or admin route, copying `generated_html` + `title` from the approved brief_page.

**Resolve:**
- For `slug_already_in_use`: edit the brief_page's `slug_hint` to a unique value, then re-approve. The bridge runs again on re-approve and produces a fresh post row. The first failed attempt left the brief_page in approved state, so re-approve will hit the `INVALID_STATE` check from `approveBriefPage` — manually flip the brief_page back to `awaiting_review` first:
  ```sql
  UPDATE brief_pages SET page_status = 'awaiting_review', version_lock = version_lock + 1
   WHERE id = '<uuid>' AND version_lock = <current_lock>;
  ```
- For systemic slug collisions (multiple sites generating posts with the same titles): the title-based slug derivation is too coarse. Long-term fix is to scope the slug under the site's prefix, OR include the brief_id in the slug. BACKLOG.

---

## Adding a new runbook entry

When a live incident surfaces a gap, write it up here the same day. Template:

```
## <Short symptom>

**Symptom:** ...
**Impact:** ...
**Diagnose:** ...
**Mitigate:** ...
**Resolve:** ...
```

Keep the Quick-reference table in sync.

---

## CI/CD — Required checks and branch protection

**E2E coverage is now a required check.** As of the E2E stabilisation work (PR #76 + branch-protection promotion), every PR to main must pass `npm run test:e2e` before auto-merge can fire.

**Why:** E2E spec failures indicate broken user flows; unit + lint tests don't catch routing errors, integration bugs, or UI state mismatches. Three pre-existing E2E spec flakes (sites archive flow, users strict-mode, images breadcrumb) were fixed in PR #76. With those stabilised, E2E is reliable enough to be a merge gate.

**Running E2E locally before pushing:**
- Prerequisite: `supabase start` (running local Postgres + API).
- Run all specs: `npm run test:e2e`.
- Run a single spec: `npm run test:e2e -- e2e/sites.spec.ts`.
- Run tests matching a grep: `npm run test:e2e -- --grep "archive flow"`.
- If you see `getByText` strict-mode violations: use `getByTestId` or scope with `getByRole('row', ...)` instead.

**When E2E is flaky (rare):**
- Check Vercel deployment logs for seed data — if the E2E admin user or fixture site didn't backfill, specs fail with "user not found" or "site not found."
- Rerun the failing PR in GitHub Actions if logs are clean (transient Playwright timing issue).
- If the same test fails twice, open an issue on the spec itself before escalating — likely a race condition or a recent code change broke the locator.
