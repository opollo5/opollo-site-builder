# UAT — Opollo Site Builder

**Built against:** `main` @ `a28ca11` (post-audit fix-pass + cron wiring + Tab 3's bulk image upload).

**Goal:** validate that the M12 / M13 operator surfaces work end-to-end on the production environment, against a populated `image_library` and a wired-up `process-transfer` cron, before we hand the tool to its first paying operator.

**Audience:** Steven (primary tester) + any second operator running scenarios in parallel.

**Sequence:**
1. Pre-UAT verification (env vars, prod state) — ~20 min.
2. Smoke tests against production (4 critical paths) — ~45 min.
3. UAT scenarios proper (per-persona workflows) — ~3-4 hours.
4. Sign-off OR fail-back to fix-pass.

**This document is the script.** Every checkbox is something an operator runs. Failures interrupt UAT and route to the runbook.

---

## 1. Pre-UAT verification

### 1.1 Vercel env vars — production scope

Open Vercel dashboard → Project → Settings → Environment Variables → filter to `Production` scope. Confirm each row below is **set and non-empty**.

| Var | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | hard | hard-throws on cold start if missing |
| `SUPABASE_ANON_KEY` | hard | client-side auth uses this |
| `SUPABASE_SERVICE_ROLE_KEY` | hard | every server-side DB write goes through this |
| `SUPABASE_DB_URL` | hard (workers) | direct Postgres URL for SKIP LOCKED / advisory locks |
| `OPOLLO_MASTER_KEY` | hard | site-credential encryption — `openssl rand -base64 32` decoded to 32 bytes |
| `ANTHROPIC_API_KEY` | hard | runner + caption hard-throw without it |
| `CRON_SECRET` | hard | Bearer auth for all cron routes; min 16 chars |
| `CLOUDFLARE_ACCOUNT_ID` | hard | `lib/cloudflare-images.ts:124-136` throws |
| `CLOUDFLARE_IMAGES_API_TOKEN` | hard | same |
| `CLOUDFLARE_IMAGES_HASH` | **HIGH per audit** | hard but currently silent-fallback; if missing, every image URL becomes `imagedelivery.net//<id>/public` (double-slash 404) |
| `LEADSOURCE_WP_URL` | hard | source WP for parse + preview |
| `LEADSOURCE_WP_USER` | hard | WP REST app-password auth |
| `LEADSOURCE_WP_APP_PASSWORD` | hard | same |
| `NEXT_PUBLIC_LEADSOURCE_WP_URL` | hard | must match `LEADSOURCE_WP_URL` (CSP + iframe) |
| `NEXT_PUBLIC_SITE_URL` | required prod | pins Supabase auth `redirectTo` to a known origin |
| `OPOLLO_FIRST_ADMIN_EMAIL` | required prod | trigger promotes this email to admin on signup |
| `OPOLLO_EMERGENCY_KEY` | required prod | break-glass auth for `/api/emergency`; min 32 chars |
| **`NEXT_PUBLIC_VERCEL_ENV`** | **HIGH per audit** | **must be `production` in this scope.** When unset, client Sentry tags every preview error as `production` via NODE_ENV fallback. Vercel does NOT auto-inject this — operator-set only. |

Optional but verify:

| Var | Verify state |
|---|---|
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | both set if Sentry is on |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | all three present for source-map upload |
| `AXIOM_TOKEN` / `AXIOM_DATASET` | both set or both unset (no-op when partial) |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_HOST` | all three set if Langfuse is on |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | both set or both unset (rate limiting fail-open when partial) |
| `FEATURE_DESIGN_SYSTEM_V2` | `true` for the v2 path |
| `FEATURE_SUPABASE_AUTH` | `true` (legacy Basic-Auth path is for emergencies only) |

- [ ] Production scope checklist run; every "hard" row set; every "HIGH" row set with the documented value.

### 1.2 Vercel env vars — preview scope

Filter to `Preview` scope. Confirm:

| Var | Required value |
|---|---|
| **`NEXT_PUBLIC_VERCEL_ENV`** | **`preview`** — this is the audit's central concern. Without it, every preview error is Sentry-tagged `production`, destroying preview/prod signal separation. |
| All `hard` vars from §1.1 | set (Vercel typically copies these by default; verify) |
| `NEXT_PUBLIC_SITE_URL` | OK to leave unset on preview (helper falls back to `request.origin`) |
| `OPOLLO_FIRST_ADMIN_EMAIL` | safe to leave at the production value or unset on preview |
| `OPOLLO_EMERGENCY_KEY` | safe to leave unset on preview — `/api/emergency` returns 503 EMERGENCY_NOT_CONFIGURED, which is the intended preview-environment behavior |

- [ ] Preview scope checklist run; `NEXT_PUBLIC_VERCEL_ENV=preview` confirmed.

### 1.3 Production DB state

Run via Supabase Studio SQL editor (production project). Each query produces one number; record it next to the checkbox.

```sql
-- Image library populated by Tab 3's bulk upload.
SELECT COUNT(*) FROM image_library WHERE deleted_at IS NULL;
-- Expected: >= 1777 per Steven's confirmation 2026-04-27.

-- Cron queue health — should be 0 or actively-draining.
SELECT state, COUNT(*) FROM transfer_job_items GROUP BY state;
-- Expected: most rows 'succeeded', 0 'failed' (or investigate failure_code if any)

-- Audit fix-pass landed — RLS policies present.
SELECT polname FROM pg_policies
WHERE tablename IN ('briefs','brief_pages','brief_runs','site_conventions','posts','generation_jobs','transfer_jobs','regeneration_jobs')
ORDER BY tablename, polname;
-- Expected: every <table>_read policy listed; the 0023/0024 fixes apply to *_read shapes.

-- First admin promotion ran (sync-first-admin.ts).
SELECT u.email, ou.role
FROM auth.users u
JOIN opollo_users ou ON ou.id = u.id
WHERE u.email = '<OPOLLO_FIRST_ADMIN_EMAIL value>';
-- Expected: role = 'admin'.
```

- [ ] `image_library` count: `_____` (>= 1777)
- [ ] `transfer_job_items` state distribution recorded; no 'failed' rows OR failure_codes investigated
- [ ] RLS policies present on all M3 / M4 / M7 / M12 / M13 tables
- [ ] First admin promoted to `admin` role

### 1.4 Cron health

```bash
# All cron routes are Bearer-auth'd. The right answer to a wrong-Bearer
# call is 401 (proves the route exists + auth is wired). The right answer
# to a missing-Bearer call is 401, NOT 404. A 404 means the route isn't
# deployed.
curl -i -X POST https://<production-url>/api/cron/process-batch \
  -H "Authorization: Bearer not-the-real-secret"
# Expected: 401

curl -i -X POST https://<production-url>/api/cron/process-regenerations \
  -H "Authorization: Bearer not-the-real-secret"
# Expected: 401

curl -i -X POST https://<production-url>/api/cron/process-brief-runner \
  -H "Authorization: Bearer not-the-real-secret"
# Expected: 401

curl -i -X POST https://<production-url>/api/cron/process-transfer \
  -H "Authorization: Bearer not-the-real-secret"
# Expected: 401 (PR #163 wired this; absence of 401 means the deploy hasn't picked up the cron entry yet)

curl -i -X POST https://<production-url>/api/cron/budget-reset \
  -H "Authorization: Bearer not-the-real-secret"
# Expected: 401
```

Then with the real secret, single-tick each cron and confirm a 200 envelope:

```bash
curl -X POST https://<production-url>/api/cron/process-transfer \
  -H "Authorization: Bearer $CRON_SECRET" | jq .
# Expected: {"ok": true, ...} — body shape varies per cron.
```

- [ ] All 5 cron routes return 401 on bad Bearer (proves deployed + auth-gated)
- [ ] Real-Bearer single-tick on `process-transfer` returns 200

### 1.5 Health endpoint

```bash
curl https://<production-url>/api/health | jq .
```

Expected `{ status: "ok", checks: {...}, build: {...}, timestamp: ... }`. `status: "degraded"` opens an investigation; do NOT proceed to smoke tests until resolved.

- [ ] `/api/health` returns 200 and `status: "ok"`

---

## 2. Smoke tests (4 critical paths)

These run against production with real-but-disposable test data. Each test is self-contained and tears down after itself. Run them in sequence; any failure halts UAT.

### 2.1 Smoke 1 — Brief upload → page → publish

**Goal:** prove the M12 page-mode runner works end-to-end on prod.

**Steps:**
1. Sign in to `/admin/sites` as the first-admin email.
2. Click an existing site (or create a fresh test site if site list is empty).
3. Navigate to the site's `/briefs` tab → click "Upload brief".
4. Upload a small markdown file (2-3 sections, ~500 words) with `content_type=page`.
5. Wait for parse → click through to `/review` → confirm parsed page list looks right.
6. Click "Commit" → confirm the runtime estimate modal shows a reasonable cost (say <$2 for a 2-3 page brief on Haiku).
7. Click "Start run" → confirm run status pill becomes `queued` then `running`.
8. Wait for cron tick (1 min). Refresh; first page should reach `awaiting_review`.
9. Click "Approve this page" on page 1.
10. Wait for next cron tick. Page 2 should reach `awaiting_review`.
11. Repeat approve/wait until all pages approved → run status = `succeeded`.
12. Navigate to the site's `/pages` tab → confirm all approved pages are listed with `generated_html`.
13. Click "Publish" on the first page → confirm the `wpCreatePost` (page) call succeeds → `wp_page_id` populates.
14. Open the published page on the WP site directly — confirm content renders.
15. Cleanup: archive (soft-delete) the test pages + brief.

**Pass:** every step works first-try; no operator-facing error banner; published page visible on WP.

**Fail conditions:**
- Parse fails → `BRIEF_PARSE_FAILED` envelope. Likely brief format issue; not a smoke failure unless persistent.
- Run never advances past `queued` → `process-brief-runner` cron not firing; check Vercel cron logs.
- Approve button missing → `awaiting_review` UI gating bug; check console for hydration errors.
- Publish hits a `_blocker_*` code → see RUNBOOK §`auth-capability-missing` / `rest-disabled` / `seo-plugin-missing`.
- Published page renders blank or unstyled → check `NEXT_PUBLIC_LEADSOURCE_WP_URL` parity with `LEADSOURCE_WP_URL`; CSP iframe sandbox might be misconfigured.

- [ ] Smoke 1 passed.

### 2.2 Smoke 2 — Brief upload → post → publish

**Goal:** prove the M13 post-mode runner + bridge work end-to-end.

**Steps:**
1. Same prep as Smoke 1.
2. Upload a small markdown brief with `content_type=post`. Note: post-mode disables anchor cycle (`MODE_CONFIGS.post.anchorExtraCycles=0`), so it'll run faster than page mode.
3. Commit + start run + drive cron ticks per Smoke 1 steps.
4. Approve page 0 (post mode briefs are typically 1 page = 1 post; multi-page post briefs are uncommon but valid).
5. Wait briefly (~1-2s); navigate to `/admin/sites/[id]/posts`.
6. Confirm a new post row exists with the bridged title; `status='draft'`; `generated_html` populated.
7. Click into the post detail → confirm the iframe preview renders.
8. Click "Publish to WP" → confirm `wpCreatePost` (post) call succeeds → `wp_post_id` populates → status flips to `published`.
9. Open the post on WP → confirm content + slug + featured-image (if applicable).
10. Click "Unpublish" → confirm modal appears with "WordPress keeps it in Trash" copy → confirm unpublish; `status='draft'`, `wp_post_id=null`.
11. Cleanup: archive the test post + brief.

**Pass:** post bridges, publishes, and unpublishes round-trip cleanly.

**Fail conditions:**
- Bridge doesn't run (no posts row appears post-approve) → see RUNBOOK §`orphan-post-row`.
- Publish blocked → same blocker codes as Smoke 1.
- Slug collision → bridge soft-fails with `slug_already_in_use`. Pick a more-unique brief title and retry.

- [ ] Smoke 2 passed.

### 2.3 Smoke 3 — Kadence palette sync

**Goal:** prove the M13-5 palette sync pipeline works against a live Kadence-bearing WP.

**Prereq:** the test site must have Kadence theme manually installed + activated (Opollo doesn't install — see M13-5c rescope decision). If Kadence isn't installed, skip this smoke and flag for UAT scenario coverage instead.

**Steps:**
1. Navigate to `/admin/sites/[id]/appearance` for a Kadence-bearing test site.
2. Wait for `/preflight` to resolve (max 15s); confirm phase = `ready`.
3. If a palette diff is shown ("Operator confirmed N slot changes"): proceed. If "No changes pending" — modify the active design system's palette slightly, then re-check. (Or skip if no DS changes available; this becomes a UAT scenario instead.)
4. Click "Sync Now" → SyncConfirmModal opens, naming the WP URL + listing the changing slots.
5. Click "Confirm sync" → wait; expect "Palette synced to WP" success state.
6. Open WP Admin → Customizer → Kadence Global Colors → confirm the Opollo-configured palette is now reflected.
7. Click "Roll back" on the appearance panel → RollbackConfirmModal opens → confirm.
8. Verify in WP Customizer that the prior palette was restored.
9. Confirm `appearance_events` audit-log entries are visible in the panel: `globals_dry_run` → `globals_confirmed` → `globals_completed` → `rollback_requested` → `rollback_completed`.

**Pass:** sync writes, roll back restores, audit log shows the full sequence.

**Fail conditions:**
- `/preflight` returns blocker → see RUNBOOK §`auth-capability-missing` / `rest-disabled`.
- Confirm-time drift detection (`WP_STATE_DRIFTED`) → see RUNBOOK §`kadence-customizer-drift`.
- Sync confirms but WP shows old palette → likely Kadence cache; force-refresh customizer.

- [ ] Smoke 3 passed (or explicitly deferred to UAT-scenario coverage with reason: __________).

### 2.4 Smoke 4 — Signin → admin → run

**Goal:** prove the auth + admin-navigation surfaces work for a non-first-admin user.

**Steps:**
1. From admin account, navigate to `/admin/users` → click "Invite operator".
2. Invite a test email (use a `+plus`-aliased Gmail or similar to avoid mailbox creation).
3. Open the invite email → click "Accept invite" → land on `/auth/reset-password` with session.
4. Set a password → land on `/admin/sites`.
5. Verify the invited user can navigate to: `/admin/sites/[id]`, `/briefs`, `/pages`, `/posts`, `/appearance`, `/budget`. Each renders without 403.
6. Verify the invited user **cannot** navigate to: `/admin/users` (admin-only). Expected: redirect to `/admin/sites` or 403 envelope.
7. From the invited user account: trigger a password change via `/account/security` (current password → new password). Confirm success message + sign-in with new password works.
8. Trigger a forgot-password flow from `/login`: click "Forgot password" → enter email → check inbox → click reset link. **This is the audit's PR #4 PKCE-callback path.** Confirm the reset link lands on `/auth/reset-password` with a working form (NOT on the "reset link expired" surface).
9. Set a new password via the reset flow → confirm sign-in with new password works.
10. Sign out from the invited user → verify `/admin/sites` redirects to `/login`.
11. Cleanup: revoke the invited user from `/admin/users`.

**Pass:** invite, sign-in, role-based gate, password-change, password-reset (with PKCE callback hop) all work.

**Fail conditions:**
- Invite email never arrives → check Supabase email config + spam folder.
- Reset link lands on "Reset link expired" → **PR #4 audit signal manifested.** Supabase project is configured for implicit-flow recovery; either reconfigure to PKCE or extend `/api/auth/callback` to handle implicit-flow tokens. Halt UAT.
- Operator can reach `/admin/users` (role gate broken) → see audit §1 capability-gating finding; halt UAT.

- [ ] Smoke 4 passed.

---

## 3. UAT scenarios

Each scenario covers a realistic operator workflow end-to-end. Run after smoke tests pass. Track each by checkbox; failures route to the matching RUNBOOK entry (see §4 Fail conditions).

### Scenario A — First-time site onboarding

**Persona:** new admin, first day on the tool.

**Goal:** add a fresh client site, configure auth, validate WP connection.

**Steps:**
1. Sign in as admin → `/admin/sites` → click "Add site".
2. Provide name, WP URL, app-password credentials.
3. Confirm site appears with `status=active`.
4. Open the site's `/preflight` (via direct URL or the appearance panel) — confirm preflight succeeds.
5. Verify `/admin/sites/[id]` detail page renders with all tabs accessible.

**Sign-off criteria:**
- [ ] Site added without errors.
- [ ] `/preflight` returns ready or surfaces a clearly-named blocker code (operator can act on it).
- [ ] All tabs (briefs, pages, posts, appearance, budget) render without 500.

### Scenario B — Run a multi-page brief through to publish

**Persona:** content operator, day two.

**Goal:** generate a 5-page site brief, review each, publish all 5.

**Steps:** identical to Smoke 1 but with a realistic 5-page brief (~3-5k words total).

**Sign-off criteria:**
- [ ] All 5 pages reach `awaiting_review` within reasonable cost/time (estimated <$5 total on Haiku, <30 min wall-clock).
- [ ] Cost rollup on the run surface matches sum-of-pages.
- [ ] Each `quality_flag` (if any) is operator-meaningful — `cost_ceiling` or `capped_with_issues`, not raw.
- [ ] Each page publishes to WP cleanly.
- [ ] Site preview iframe renders the published pages.

### Scenario C — Run a post brief, publish, unpublish

**Persona:** content operator publishing a blog post.

**Goal:** brief → 1 post → published → unpublished → re-published.

**Steps:** identical to Smoke 2 but with an actual blog-post-shaped brief (~800-1500 words, with meta description).

**Sign-off criteria:**
- [ ] Post-mode quality gates fire correctly: meta-description length capped at 300 chars (longer drafts rejected with `POST_META_DESCRIPTION_TOO_LONG`).
- [ ] Bridge writes a posts row matching the brief title (no slug collision on the first publish).
- [ ] Unpublish → re-publish round-trip preserves `posts.id` (only `wp_post_id` changes; same row is reused).
- [ ] Post visible on WP with proper excerpt + slug.

### Scenario D — Kadence palette change cycle

**Persona:** designer revising a site's brand colors.

**Goal:** modify the Opollo design system → sync to WP Kadence → verify live → roll back.

**Steps:**
1. Navigate to `/admin/sites/[id]/design-systems` → activate a different DS or edit the palette of the active one.
2. Navigate to `/admin/sites/[id]/appearance` → confirm `/preflight` is `ready` and shows the diff.
3. Click "Sync Now" → confirm modal → confirm sync.
4. Open WP Customizer → confirm new palette.
5. Open a published page on the site → confirm color tokens reflect the new palette.
6. Click "Roll back" → confirm modal → confirm rollback.
7. Verify WP Customizer shows the prior palette.
8. Verify `appearance_events` audit log shows the full sequence chronologically.

**Sign-off criteria:**
- [ ] Sync completes without `WP_STATE_DRIFTED`.
- [ ] WP visually matches the synced palette.
- [ ] Rollback restores prior palette.
- [ ] Audit log entries are operator-readable (labels, not raw event names).

### Scenario E — User management

**Persona:** admin onboarding a teammate.

**Goal:** invite operator + viewer; verify role gating.

**Steps:** identical to Smoke 4 plus:
1. Invite a `viewer` role user.
2. From the viewer account: confirm `/admin/sites` lists the site, but read-only — buttons that mutate (invite, archive, run, publish) are absent or disabled.
3. From the operator account: confirm those buttons ARE present and functional.
4. From the admin account: revoke the operator → operator can no longer access `/admin/sites`.
5. Re-invite the same email → invite re-arrives → user can re-accept (Supabase Auth handles the re-invite cleanly).

**Sign-off criteria:**
- [ ] Role gates enforced consistently across UI (not just at the API).
- [ ] Revoke is immediate (no stale session keeps the user in).
- [ ] Re-invite flow doesn't leave duplicate `opollo_users` rows.

### Scenario F — Password rotation

**Persona:** any user rotating credentials.

**Steps:** for each of admin, operator, viewer:
1. Sign in.
2. `/account/security` → change password → confirm new password works on next sign-in.
3. Sign out → `/login` → "Forgot password" → email link → set new password (via PKCE callback) → confirm new password works.

**Sign-off criteria:**
- [ ] All three roles can rotate their own password.
- [ ] Both flows (account change + forgot-password) succeed.
- [ ] Old passwords reject on sign-in after rotation.

### Scenario G — Cost-ceiling and budget enforcement

**Persona:** admin monitoring spend.

**Steps:**
1. Configure a small per-page ceiling (e.g., 50c) on a test tenant via `/admin/sites/[id]/budget`.
2. Run a brief that's likely to hit the ceiling (large pages, more visual iterations).
3. Confirm `quality_flag = 'cost_ceiling'` appears on the affected page card.
4. Confirm the per-run cost rollup matches sum-of-pages.
5. Configure a daily budget at $5 on the tenant.
6. Run multiple briefs in quick succession to approach the cap.
7. Confirm `BUDGET_EXCEEDED` fires on the next run.
8. Confirm `/api/cron/budget-reset` (hourly cron) — actually a daily reset — does its work the next day OR via manual call.

**Sign-off criteria:**
- [ ] Per-page ceiling enforced (no runaway visual iterations).
- [ ] Daily budget enforced (no runaway runs).
- [ ] Cost rollup never drifts from sum-of-pages.

### Scenario H — Soft-delete and recovery

**Persona:** admin cleaning up after a UAT mistake.

**Goal:** validate the audit-fix soft-delete RLS posture.

**Steps:**
1. Soft-delete a post via `/admin/sites/[id]/posts/[id]` archive button.
2. From the same user (admin), refresh the posts list → confirm the soft-deleted post is HIDDEN (PR #161 fix).
3. From a Supabase Studio SQL editor (service role) → confirm the row still exists with `deleted_at IS NOT NULL`.
4. Run an "include archived" admin recovery (if present) — confirm only service-role paths see deleted rows.
5. Repeat for briefs, brief_pages.

**Sign-off criteria:**
- [ ] Soft-deleted rows hidden from authenticated reads (admin + operator + viewer all blocked).
- [ ] Service-role queries still see them (recovery path intact).

---

## 4. Fail conditions / rollback plan

If any UAT scenario fails:

1. **Halt UAT.** Don't run subsequent scenarios — issues compound.
2. **Capture the request ID** from the response headers (`x-request-id`) and any operator-visible error code/message.
3. **Match to a RUNBOOK entry:**
   - Auth/login issues → §`Auth is broken` or §`Admin locked out`
   - Publish blocker → §`auth-capability-missing` / §`rest-disabled` / §`seo-plugin-missing`
   - Palette sync drift → §`kadence-customizer-drift`
   - Stuck brief run → §`stuck-brief-run`
   - Orphan post row → §`orphan-post-row`
   - WP publish failure → §`WordPress publish failures`
   - Supabase row budget exceeded → §`Supabase out of row budget`
   - Suspected key leak → §`Security incident — suspected key leak` (immediate)
4. **If the runbook doesn't cover it:** treat as a new BACKLOG entry; document scope, observed symptoms, suspected root cause; do NOT freelance a fix during UAT.
5. **Rollback path:**
   - Code regression in a recent merge → revert via `gh pr revert <pr-number>` then redeploy.
   - Migration regression → run the matching `.down.sql` against prod (under maintenance window), then redeploy code from before the bad migration's commit. **Note:** AUDIT.md §6 flagged 7 migrations without rollback files — `0001`, `0007`, `0008`, `0009`, `0011`, `0012`, `0014`. If one of those is the culprit, restore-from-backup is the only recovery; engage support immediately.
   - Env-var misconfig → fix in Vercel dashboard, redeploy.

---

## 5. Sign-off criteria

UAT passes when:

- [ ] All 4 smoke tests pass on first run (re-run only after a fix-pass; do NOT pass UAT off a third try).
- [ ] All 8 scenarios (A-H) pass.
- [ ] No new BACKLOG-worthy issues surfaced in scenarios. (Cosmetic / copy issues are OK to defer.)
- [ ] Steven signs off this document with a date + checkbox per section.
- [ ] Sentry dashboard shows zero `production` environment errors during the UAT window. (Preview-tagged errors during smoke tests are expected; production-tagged ones during UAT mean a real prod-user-affecting issue.)
- [ ] Cost dashboard shows total UAT spend within budget (~$30-50 for full run on Haiku across all scenarios).

If any single sign-off criterion fails: do NOT hand the tool to a paying operator. Loop back to a fix-pass + re-run UAT.

---

## 6. UAT execution notes

- **Run smoke tests first**, in sequence, before any scenario. They catch deploy-level issues (env vars, cron wiring) cheaper than scenarios do.
- **One scenario at a time**, by one operator. Parallel scenarios on the same site can mask issues by interfering with each other's state (e.g., two brief runs racing on the same site's `site_conventions`).
- **Track each checkbox.** Don't trust memory across a 4-hour session; the checkboxes are the audit trail.
- **Cleanup between scenarios** — delete test sites, archive test briefs, revoke test users. UAT residue can confuse a future paying operator's first impression.
- **Sentry / Langfuse open in a tab.** Each scenario should produce its own trace; absence of a trace mid-scenario is a signal worth investigating.

---

## 7. Out of scope for THIS UAT pass

Per AUDIT.md §"What's NOT in this audit" + the audit-fix-pass scope decisions:

- **Performance / load.** Lighthouse CI on `/login` only; admin surfaces under realistic-volume seed not measured. Defer to a perf-focused milestone post-UAT.
- **Accessibility.** `auditA11y` runs on every E2E spec but findings are non-blocking; no formal axe summary across all admin surfaces.
- **Multi-tenancy.** Single-tenant by design; cross-tenant scoping is not part of UAT scope.
- **Cloudflare → S3 migration.** Per audit Option A: fix in place. The deferred manual-upload UI + variants health-check are M16 / post-UAT scope.
- **`appearance_events` no auth-role policy.** Service-role-only today; flag for post-UAT cleanup.
- **Site actions dropdown overflow.** Cosmetic; M16 / post-UAT scope.
- **Dead code (`lib/content-schemas.ts`, `lib/seo-plugin-detection.ts`).** Post-UAT cleanup PR.
- **Deferred staging-env E2E** (sync confirm post-action + actual WP publish in CI). Per BACKLOG; the current UAT scenarios are the manual proxy for this coverage.

If any of these surface as UAT-blocking during execution: escalate; do not freelance.
