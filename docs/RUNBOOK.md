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
- `OPOLLO_MASTER_KEY` → generate new key (`openssl rand -base64 32`), stage it as `OPOLLO_MASTER_KEY_NEXT`, run the rotation migration that re-encrypts all `sites.wp_app_password` with the new key, swap the env var, redeploy. (Rotation script is a follow-up — for now, manual re-register of each site works as a last resort.)
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

Zero-downtime rotation:

1. `openssl rand -base64 32` → new key.
2. Set `OPOLLO_MASTER_KEY_NEXT` in Vercel env to the new key; leave `OPOLLO_MASTER_KEY` as the old key. Redeploy.
3. Run the rotation script (follow-up slice — for now, re-register each site through the Edit Site modal: the app encrypts with the new key on save).
4. When every site row has been re-encrypted: set `OPOLLO_MASTER_KEY` to the new key, remove `OPOLLO_MASTER_KEY_NEXT`. Redeploy.
5. Confirm: for every site, `editSiteModal → Save` round-trips successfully.

**Downtime window:** none if staged. If the rotation script lands, this becomes a single-step rotation.

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
   - Langfuse: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, optionally `LANGFUSE_BASEURL` if self-hosted.
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
