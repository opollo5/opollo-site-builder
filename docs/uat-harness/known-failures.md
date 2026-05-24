# UAT Harness — Known Failures

This file documents expected failures on first run of the UAT harness.
Each entry has a severity (P0/P1/P2), the failing spec, and a likely root cause.
These become the next session's backlog.

---

## Blockers (all specs fail until resolved)

### KF-0A — STAGING_UAT_SECRET not configured

**Spec:** All specs  
**Assertion:** `signInAsUatBot(page)` throws `STAGING_UAT_SECRET is not set`  
**Root cause:** `STAGING_UAT_SECRET` env var has not been added to Vercel (staging branch) or GitHub Actions secrets. The `/api/uat/sign-in` route returns HTTP 500 without this.  
**Severity:** Blocker — all specs  
**Fix:** Add `STAGING_UAT_SECRET` to Vercel staging branch env vars + GitHub Actions secrets. See `docs/uat-harness/STATUS.md`.  
**GitHub issue:** _(open one and link here)_

---

### KF-0B — Vercel Preview Protection blocks page navigation

**Spec:** All specs  
**Assertion:** `page.goto(UAT_BASE_URL + ...)` returns HTTP 401 (Vercel SSO wall)  
**Root cause:** The staging Vercel deployment has Preview Protection enabled. External Playwright runners cannot reach any page without a bypass secret or disabling protection.  
**Severity:** Blocker — all specs  
**Fix (Option A):** Add `VERCEL_BYPASS_SECRET` env var (from Vercel → Project → Settings → Deployment Protection → Protection Bypass for Automation). Set in GitHub Actions secrets as `VERCEL_BYPASS_SECRET`.  
**Fix (Option B):** Disable Preview Protection for the `staging` branch in Vercel → Project → Settings → Deployment Protection.  
**GitHub issue:** _(open one and link here)_

---

## P0 failures (critical bugs)

### KF-1 — Composer edit mode: content not populating when clicking calendar chip

**Spec:** `e2e/uat/composer.spec.ts` — "open composer by clicking a calendar chip — content populates"  
**Assertion:** `textarea` content is non-empty after opening from chip click  
**Root cause:** Known regression from PR #993 + PR #1022. The composer opens in edit mode but the draft content is not loaded into the textarea. The `?compose={draftId}` URL param is set but the draft hydration fails.  
**Severity:** P0  
**GitHub issue:** _(open one and link here)_

---

### KF-2 — Date picker rendered at half intended size

**Spec:** `e2e/uat/composer.spec.ts` — "Schedule tab — date picker is at least 280px wide"  
**Assertion:** `box.width >= 280`  
**Root cause:** Schedule tab date input is rendering at reduced width (~120px). Likely a Tailwind utility conflict or container sizing issue in the composer overlay.  
**Severity:** P0  
**GitHub issue:** _(open one and link here)_

---

### KF-3 — Save-on-close deletes the scheduled post being edited

**Spec:** `e2e/uat/composer.spec.ts` — "edit a scheduled post → close with X → Save → post still on calendar"  
**Assertion:** Post chip still visible on calendar after saving  
**Root cause:** When the user edits a scheduled post, makes changes, clicks X, then clicks "Save" on the unsaved-changes dialog, the post is deleted from the calendar instead of being updated. The save path is calling delete + create instead of update.  
**Severity:** P0  
**GitHub issue:** _(open one and link here)_

---

## P1 failures (non-blocking bugs)

### KF-4 — Media library count in composer doesn't match /admin/images

**Spec:** `e2e/uat/media-library.spec.ts` — "composer Library tab count matches /admin/images count"  
**Assertion:** `composerCount > 0` and matches admin page count  
**Root cause:** Potential regression from PR #1024. The composer's media library may be scoped incorrectly (loading images for a different company or filtering by company_id when image_library is a global table).  
**Severity:** P1  
**GitHub issue:** _(open one and link here)_

---

### KF-5 — /admin/* pages may 403 for UAT ghost user

**Spec:** `e2e/uat/admin.spec.ts` — multiple tests  
**Assertion:** Pages load at `/admin/*` URLs  
**Root cause:** The UAT ghost user (`uat-bot@staging.opollo.com`) has `role='user'` or `role='admin'` on `platform_company_users` for the UAT company. Many `/admin/*` routes require `super_admin` or `admin` on the `opollo_users` table (the Opollo platform admin table, not the per-company platform_users table). The ghost user may not have sufficient privileges.  
**Severity:** P1  
**Fix:** Promote `uat-bot@staging.opollo.com` to `admin` on `opollo_users` in the staging Supabase. Update the seed script to set this.  
**GitHub issue:** _(open one and link here)_

---

## P2 failures

### KF-6 — Insights/analytics shows no data for UAT company

**Spec:** `e2e/uat/insights.spec.ts` — period selector tests  
**Assertion:** Page loads and period filter works  
**Root cause:** The UAT seed data includes only 1 analytics snapshot. The insights page may render empty charts or an empty state that could be mistaken for an error.  
**Severity:** P2  
**Fix:** Add more analytics snapshots to the seed script covering the last 90 days.  
**GitHub issue:** _(open one and link here)_

---

## Maintenance notes

- Issues are opened per failure with label `uat-finding`
- P0 failures block UAT harness from being useful — fix these first
- P1 and P2 failures are tracked but do not block PR merges (until baselines stabilise)
- Re-run: `npx playwright test e2e/uat/ --config playwright.uat.config.ts`
