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
