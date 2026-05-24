# UAT Harness — Known Failures

This file documents expected failures on first run of the UAT harness.
Each entry has a severity (P0/P1/P2), the failing spec, and a likely root cause.
These become the next session's backlog.

**Last updated:** 2026-05-25 after harness run [26375514633](https://github.com/opollo5/opollo-site-builder/actions/runs/26375514633) — auth finally working end-to-end. 22 pass / 26 fail / 2 skip out of 50.

---

## Resolved blockers (kept for history)

### KF-0A — `STAGING_UAT_SECRET` not configured ✅ RESOLVED 2026-05-24

`STAGING_UAT_SECRET` added to both Vercel staging Preview env and GitHub Actions secrets. Sign-in route returns 200 with valid bearer.

### KF-0B — Vercel Preview Protection blocks page navigation ✅ RESOLVED 2026-05-24

`VERCEL_BYPASS_SECRET` added to GitHub Actions secrets. Playwright passes `x-vercel-protection-bypass` header via `extraHTTPHeaders` in `playwright.uat.config.ts`. Health check + page navigation both succeed.

### KF-0C — `SUPABASE_ANON_KEY` mismatch on staging Vercel ✅ RESOLVED 2026-05-25

Steven discovered (via the audit doc walkback at `docs/staging/PRODUCTION_LEAK_AUDIT.md`) that the staging Vercel Preview env had a different `SUPABASE_ANON_KEY` value from `NEXT_PUBLIC_SUPABASE_ANON_KEY`. After aligning them, the middleware's `getUser()` call succeeds and the sign-in session is accepted on subsequent navigation. This was the silent root cause of "sign-in returns 200 but next request redirects to /login".

---

## Open P0 failures (critical bugs)

### KF-1 — Composer edit mode: content not populating when clicking calendar chip

**Spec:** `e2e/uat/composer.spec.ts:47:7` — "open composer by clicking a calendar chip — content populates (regression PR #993 + #1022)"
**Assertion:** `expect(locator).toBeVisible() failed`
**Root cause:** Known regression. The composer opens but the draft content does not load into the textarea. `?compose={draftId}` URL param hydration is broken.
**GitHub issue:** _(open one)_

### KF-2 — Date picker rendered at half intended size ✅ RESOLVED

Confirmed passing in run [#26375514633](https://github.com/opollo5/opollo-site-builder/actions/runs/26375514633) — `e2e/uat/composer.spec.ts:194` passes. Fix landed.

### KF-3 — Save-on-close deletes the scheduled post being edited

**Specs:**
- `e2e/uat/composer.spec.ts:258:7` — "edit a scheduled post → close with X → Save → post still on calendar (regression: save-deletes-post bug)"
- `e2e/uat/composer.spec.ts:317:7` — "edit scheduled post → close with X → Don't save → post still on calendar"

**Assertion:** `expect(locator).toBeVisible() failed`
**Root cause:** Save path is delete+insert instead of update. Both Save and Don't-Save branches lose the post.
**GitHub issue:** _(open one)_

### KF-7 — Admin pages cause ERR_TOO_MANY_REDIRECTS for UAT ghost user 🆕

**Specs:** 6 specs across `admin.spec.ts` + `visual.spec.ts` (see issue).
**Assertion:** `page.goto: net::ERR_TOO_MANY_REDIRECTS`
**Root cause:** Ghost user is authenticated but lacks `admin` role on `opollo_users`. Admin gate redirects to `/login`, `/login` sees authenticated session, redirects back — infinite loop.
**Supersedes:** KF-5 (which predicted a 403; actual behaviour is worse).
**GitHub issue:** [#1040](https://github.com/opollo5/opollo-site-builder/issues/1040)

### KF-8 — AI assist dialog regression (PR #1023) 🆕

**Spec:** `e2e/uat/composer.spec.ts:74:7`
**Assertion:** `expect(received).not.toContain(expected)` — duplicate close button OR unfilled Generate button.
**GitHub issue:** [#1041](https://github.com/opollo5/opollo-site-builder/issues/1041)

### KF-9 — Sign-out nav button testid missing 🆕

**Spec:** `e2e/uat/auth.spec.ts:48:7`
**Assertion:** `expect(locator('[data-testid="nav-sign-out"]')).toBeVisible() failed`
**Root cause:** Nav element no longer has the expected testid, or it's behind a profile-menu trigger the spec doesn't open.
**GitHub issue:** [#1042](https://github.com/opollo5/opollo-site-builder/issues/1042)

### KF-10 — Connections list / status pills / disconnect button not visible 🆕

**Specs:** 3 specs in `connections.spec.ts` (lines 23, 40, 54).
**Assertion:** `expect(locator).toBeVisible() failed`
**Root cause:** Either UAT seed data missing 3 connections for the UAT company, or selector drift after a connections-list refactor.
**GitHub issue:** [#1043](https://github.com/opollo5/opollo-site-builder/issues/1043)

---

## Open P1 failures (non-blocking bugs)

### KF-4 — Media library count in composer

**Spec:** `e2e/uat/composer.spec.ts:114:7` — "Media Library tab shows images (image count > 5) (regression PR #1024)"
**Assertion:** Test timeout of 45000ms exceeded.
**Root cause:** Likely UAT seed images don't reach count > 5, OR composer's Library tab query is slow. Timing out means the assertion `expect(count).toBeGreaterThan(5)` never resolves.
**GitHub issue:** _(open one if confirmed real)_

### KF-5 — /admin/* pages may 403 for UAT ghost user ⚠️ SUPERSEDED BY KF-7

Closed; KF-7 above captures the actual failure mode (redirect loop, not 403).

### KF-11 — Save as draft → post not appearing in /company/social/posts 🆕

**Spec:** `e2e/uat/composer.spec.ts:219:7`
**Assertion:** Test timeout of 45000ms exceeded.
**Root cause:** Either draft creation fails silently or `/company/social/posts` doesn't list it. Could be a real bug or a test-step ordering issue. Needs manual reproduction before opening an issue.

---

## P2 / infrastructure

### KF-6 — Insights/analytics shows no data for UAT company

Status unchanged. Tests do not appear in run output (likely passing or filtered).

### KF-12 — Visual regression baselines missing 🆕 INFRA

**Specs:** 3 specs in `visual.spec.ts` (calendar grid, composer empty, AI assist dialog, schedule date picker — the ones without redirect issues).
**Error:** `A snapshot doesn't exist at e2e/uat/__screenshots__/visual.spec.ts/<name>-linux.png, writing actual.`
**Fix:** First-time baselines need to be committed. Push a commit with message containing `regen-baselines` — the workflow will run with `--update-snapshots` and commit the new baselines back to the branch.

### KF-13 — Calendar grid `toHaveCount` type error 🆕 TEST CODE BUG

**Spec:** `e2e/uat/calendar.spec.ts:24:7`
**Error:** `locator._expect: expectedNumber: expected float, got object`
**Root cause:** Test passes an object to `toHaveCount()` instead of a number. Fix in the spec, not in the app.

---

## Maintenance notes

- Issues are opened per failure with label `uat-finding`
- P0 failures block UAT harness from being useful — fix these first
- P1 and P2 failures are tracked but do not block PR merges
- Re-run: `gh workflow run uat-harness.yml --ref staging`
