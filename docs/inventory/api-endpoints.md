# API Endpoints Inventory

**Generated:** 2026-05-26
**Branch:** fix/composer-central-image-library
**Status:** Skeleton — EXPECTED BEHAVIOUR sections are empty checkboxes for Steven to fill in.

---

## Auth patterns legend

| Tag | Meaning |
|---|---|
| `admin-only` | `requireAdminForApi()` — requires `opollo_users.role` of `admin` or `super_admin` |
| `platform-auth` | `requireCanDoForApi()` / `requirePlatformAuth()` — platform session with per-company permission check |
| `cron-secret` | `CRON_SECRET` header validation |
| `webhook-sig` | HMAC signature header verification (no session) |
| `token-gated` | Single-use token in URL path (no session required) |
| `public` | No authentication required |

---

## 1. Auth Routes

### GET /api/auth/callback
**Auth:** public
**Risk:** CRITICAL
**Query params:** `code` (PKCE) OR `token_hash` + `type` (OTP); optional `next`
**Response:** `302` → `?next=` (sanitised same-origin) or `/admin/sites`; `302` → `/auth-error?reason=` on failure
**Notes:** Handles both PKCE and OTP Supabase link shapes. Signs out existing session before exchange to prevent cookie pollution. Rate-limited by IP (`auth_callback`).
**Currently tested:** unit (regression), UAT spec
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Rejects `?next=https://external.com` open-redirect attempts?
- [ ] Missing `code` AND missing `token_hash` → redirects to `/auth-error?reason=missing_code`?
- [ ] Expired token → `/auth-error?reason=exchange_failed`?

### GET /api/auth/ping
**Auth:** public
**Risk:** LOW
**Response:** `200 { ok: true }`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Always returns 200 regardless of session state?

### GET /api/auth/challenge-status
**Auth:** public (reads challenge cookie)
**Risk:** MEDIUM
**Response:** `200 { pending: boolean, email?: string }`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Returns `pending: false` when no 2FA cookie present?

### POST /api/auth/complete-login
**Auth:** public
**Risk:** CRITICAL
**Notes:** Finalises 2FA challenge flow.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Invalid OTP code → 401?
- [ ] Expired challenge → 401?

### POST /api/auth/resend-challenge
**Auth:** public
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Rate limited?

### POST /api/auth/forgot-password
**Auth:** public
**Risk:** MEDIUM
**Body:** `{ email: string }`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Returns 200 regardless of whether email exists (no enumeration)?
- [ ] Rate limited?

### GET /api/auth/reset-password
### POST /api/auth/reset-password
**Auth:** public
**Risk:** HIGH
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Token expiry enforced?
- [ ] One-use token (cannot be reused)?

### GET /api/auth/accept-invite
**Auth:** public
**Risk:** HIGH
**Notes:** Invite acceptance via magic link. Sets session.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Expired invite link → error page?

### GET /api/auth/approve-here
**Auth:** public
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What approval flow does this serve?

---

## 2. Account Routes

### POST /api/account/change-password
**Auth:** platform-auth (authenticated user)
**Risk:** HIGH
**Body:** `{ current_password: string, new_password: string }`
**RLS dependency:** `opollo_users`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Wrong current_password → 401/422?
- [ ] Rate limited?
- [ ] New password meets minimum complexity?

### GET /api/account/devices/[id]
**Auth:** platform-auth
**Risk:** MEDIUM
**RLS dependency:** `user_devices`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Cannot read another user's device?

### DELETE /api/account/devices/[id]
**Auth:** platform-auth
**Risk:** HIGH
**Notes:** Revokes a specific device session.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Cannot revoke another user's device?

### POST /api/account/devices/sign-out-others
**Auth:** platform-auth
**Risk:** HIGH
**Notes:** Signs out all other devices for the current user.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does not sign out the current device?

---

## 3. Approval Routes

### POST /api/approve/[token]/decision
**Auth:** token-gated (no session required)
**Risk:** HIGH
**Body:** `{ decision: "approve" | "reject", comment?: string }`
**Notes:** External approver flow — token is embedded in approval email links.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Expired token → 401?
- [ ] Token can only be used once?
- [ ] Decision persists and triggers downstream state change?

---

## 4. Admin — User Management

### GET /api/admin/users/list
**Auth:** admin-only
**Risk:** MEDIUM
**Response:** `200 { data: User[] }`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Non-admins receive 403?

### POST /api/admin/users/invite
**Auth:** admin-only
**Risk:** HIGH
**Body:** `{ email: string, role: "admin" | "user" }`
**RLS dependency:** `opollo_users`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Duplicate email → 409 or idempotent re-send?

### PATCH /api/admin/users/[id]/role
**Auth:** admin-only (`admin` or `super_admin`)
**Risk:** CRITICAL
**Body:** `{ role: "admin" | "user" }`
**Response:** `200 { changed: boolean }` / `409 CANNOT_MODIFY_SELF` / `409 LAST_ADMIN` / `409 SUPER_ADMIN_LOCKED`
**RLS dependency:** `opollo_users`
**Currently tested:** unit (regression pinned)
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Admin cannot demote themselves (CANNOT_MODIFY_SELF)?
- [ ] Last admin cannot be demoted (LAST_ADMIN)?
- [ ] super_admin row is immutable (SUPER_ADMIN_LOCKED)?
- [ ] Rate limited per user (`user_mgmt`)?

### POST /api/admin/users/[id]/revoke
**Auth:** admin-only
**Risk:** HIGH
**RLS dependency:** `opollo_users`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Revoked user cannot authenticate on next request?

### POST /api/admin/users/[id]/reinstate
**Auth:** admin-only
**Risk:** HIGH
**RLS dependency:** `opollo_users`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Only works on previously revoked users?

---

## 5. Admin — Invites

### GET /api/admin/invites
**Auth:** admin-only
**Risk:** LOW
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Returns only pending invites?

### POST /api/admin/invites
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Duplicate invite handled gracefully?

### DELETE /api/admin/invites/[id]
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Cannot delete already-accepted invite?

---

## 6. Admin — Companies

### GET /api/admin/companies
### POST /api/admin/companies
**Auth:** admin-only
**Risk:** HIGH
**RLS dependency:** `platform_companies`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Company creation provisions bundle.social team?

---

## 7. Admin — Social Profiles & Analytics

### GET /api/admin/companies/[id]/social-profiles
### POST /api/admin/companies/[id]/social-profiles
**Auth:** admin-only
**Risk:** HIGH
**RLS dependency:** `platform_social_profiles`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Profile creation provisions bundle.social team?

### GET /api/admin/companies/[id]/social-profiles/[profileId]
### PATCH /api/admin/companies/[id]/social-profiles/[profileId]
### DELETE /api/admin/companies/[id]/social-profiles/[profileId]
**Auth:** admin-only
**Risk:** HIGH
**RLS dependency:** `platform_social_profiles`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Cross-company profile access blocked?

### POST /api/admin/companies/[id]/social-profiles/[profileId]/connect
**Auth:** admin-only
**Risk:** CRITICAL
**Notes:** Admin-side initiation of bundle.social OAuth for a profile.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Returns redirect URL to bundle.social OAuth?

### POST /api/admin/companies/[id]/social-profiles/[profileId]/disconnect
**Auth:** admin-only
**Risk:** CRITICAL
**Notes:** Admin-side disconnect — calls bundle.social SDK then deletes DB row.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Split-brain detection if bundle.social still holds the account?

### GET /api/admin/companies/[id]/social-profiles/[profileId]/analytics/dashboard
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Returns cached analytics data?

### POST /api/admin/companies/[id]/social-profiles/[profileId]/analytics/refresh
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Triggers re-fetch from bundle.social?

---

## 8. Admin — Image Library

### GET /api/admin/images/list
**Auth:** admin-only
**Risk:** LOW
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Supports pagination?
- [ ] Supports filtering by soft-deleted?

### POST /api/admin/images/upload
**Auth:** admin-only
**Risk:** MEDIUM
**Notes:** Uploads image to Supabase storage.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] File type validation?
- [ ] Max size enforced?

### POST /api/admin/images/fetch-url
**Auth:** admin-only
**Risk:** MEDIUM
**Body:** `{ url: string }`
**Notes:** Fetches remote image and stores it locally.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] SSRF protection on URL?

### POST /api/admin/images/check-existing
**Auth:** admin-only
**Risk:** LOW
**Notes:** Checks whether an image (by hash or URL) already exists.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Returns existing image id if found?

### POST /api/admin/images/bulk-hard-delete
**Auth:** admin-only
**Risk:** HIGH
**Notes:** Permanently deletes multiple images from storage and DB.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Irreversible — no undo path?
- [ ] Rejects images still referenced by active posts?

### GET /api/admin/images/[id]
### PATCH /api/admin/images/[id]
### DELETE /api/admin/images/[id]
**Auth:** admin-only
**Risk:** MEDIUM / HIGH (DELETE)
**RLS dependency:** `images`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] PATCH updates metadata only (not storage object)?
- [ ] DELETE is soft (sets deleted_at)?

### POST /api/admin/images/[id]/restore
**Auth:** admin-only
**Risk:** MEDIUM
**Notes:** Restores a soft-deleted image.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Only works on soft-deleted images?

### POST /api/admin/images/[id]/hard-delete
**Auth:** admin-only
**Risk:** HIGH
**Notes:** Permanently deletes single image.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Cannot hard-delete an image referenced by active posts?

### GET /api/admin/images/[id]/download
**Auth:** admin-only
**Risk:** LOW
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Returns a signed download URL?

### POST /api/admin/images/[id]/reextract
**Auth:** admin-only
**Risk:** LOW
**Notes:** Re-runs metadata extraction job for an image.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Idempotent?

---

## 9. Admin — Media

### POST /api/admin/media/[id]/promote
**Auth:** admin-only
**Risk:** MEDIUM
**Notes:** Promotes a media item from company scope to global/shared image library.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What does "promote" mean operationally?

---

## 10. Admin — Sites

### GET /api/admin/sites/[id]/onboarding
### POST /api/admin/sites/[id]/onboarding
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Idempotent re-trigger?

### POST /api/admin/sites/[id]/budget
**Auth:** admin-only
**Risk:** HIGH
**Notes:** Sets or updates the site generation budget.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Validates budget is positive?

### POST /api/admin/sites/[id]/use-image-library
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Attaches the global image library to this site?

### GET /api/admin/sites/[id]/voice
### POST /api/admin/sites/[id]/voice
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Voice settings stored per-site?

### GET /api/admin/sites/[id]/pages/[pageId]
### PATCH /api/admin/sites/[id]/pages/[pageId]
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Cross-site page access blocked?

### POST /api/admin/sites/[id]/pages/[pageId]/regenerate
**Auth:** admin-only
**Risk:** HIGH
**Notes:** Re-queues a page for AI regeneration. Consumes budget.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Budget check before queuing?

### POST /api/admin/sites/[id]/setup/extract
**Auth:** admin-only
**Risk:** HIGH
**Notes:** Triggers AI extraction of site data from a URL.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] SSRF protection on input URL?

### POST /api/admin/sites/[id]/setup/extract/save
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Validates extracted data before saving?

### POST /api/admin/sites/[id]/setup/extract-screenshots
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] SSRF protection on input URL?

### POST /api/admin/sites/[id]/setup/extract-design
### POST /api/admin/sites/[id]/setup/extract-tone
**Auth:** admin-only
**Risk:** HIGH
**Notes:** AI extraction of design tokens and brand tone. Consumes AI credits.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Budget check before triggering?

### POST /api/admin/sites/[id]/setup/approve-design
### POST /api/admin/sites/[id]/setup/approve-tone
### POST /api/admin/sites/[id]/setup/apply-tone
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can only approve when pending approval state?

### POST /api/admin/sites/[id]/setup/generate-concepts
**Auth:** admin-only
**Risk:** HIGH
**Notes:** AI concept generation. Consumes credits.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Budget check before triggering?

### POST /api/admin/sites/[id]/setup/refine-concept
**Auth:** admin-only
**Risk:** HIGH
**Notes:** AI concept refinement. Consumes credits.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Idempotent?

### POST /api/admin/sites/[id]/setup/regenerate-tone-samples
**Auth:** admin-only
**Risk:** HIGH
**Notes:** Regenerates tone samples. Consumes credits.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Rate limited?

### POST /api/admin/sites/[id]/setup/save-brief
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Validates brief schema?

### POST /api/admin/sites/[id]/setup/skip
**Auth:** admin-only
**Risk:** LOW
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Marks setup step as skipped?

---

## 11. Admin — Design System Settings

### GET /api/admin/design-system-settings
### PATCH /api/admin/design-system-settings
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Settings are global (not per-site)?

---

## 12. Admin — Theming

### GET /api/admin/theming/[companyId]
### PATCH /api/admin/theming/[companyId]
**Auth:** admin-only
**Risk:** MEDIUM
**RLS dependency:** `platform_companies`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Cross-company theming access blocked?

---

## 13. Admin — Email Test

### POST /api/admin/email-test
**Auth:** admin-only
**Risk:** LOW
**Notes:** Sends a test email to verify SendGrid config.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Only sends to verified admin addresses?

---

## 14. Admin — Jobs

### POST /api/admin/jobs/extract-image-metadata
**Auth:** admin-only
**Risk:** MEDIUM
**Notes:** Triggers bulk metadata extraction for unprocessed images.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Idempotent (does not re-process already-extracted images)?

---

## 15. Admin — Batch

### GET /api/admin/batch
### POST /api/admin/batch
**Auth:** admin-only
**Risk:** HIGH
**Notes:** Creates and lists page generation batches.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Budget check before batch creation?

### POST /api/admin/batch/[id]/cancel
**Auth:** admin-only
**Risk:** HIGH
**Notes:** Cancels an in-progress batch.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Cannot cancel already-completed batch?
- [ ] Partial completion handled correctly?

---

## 16. Admin — Insights

### POST /api/admin/insights/clients/[id]/competitors
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Validates competitor URL?

### PATCH /api/admin/insights/clients/[id]/competitors/[competitorId]
### DELETE /api/admin/insights/clients/[id]/competitors/[competitorId]
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Cross-client competitor access blocked?

### POST /api/admin/insights/clients/[id]/annotate/[recId]
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Annotation stored per-rec?

### POST /api/admin/insights/clients/[id]/dismiss/[recId]
### POST /api/admin/insights/clients/[id]/unsuppress/[recId]
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Dismiss is reversible via unsuppress?

---

## 17. Admin — Maintenance

### POST /api/admin/maintenance/reconcile-bundlesocial
**Auth:** admin-only
**Risk:** CRITICAL
**Notes:** Reconciles DB connections against bundle.social state. May delete orphaned rows.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Dry-run mode available?
- [ ] Logs all mutations?

### POST /api/admin/maintenance/social-connections/[id]/reattribute
**Auth:** admin-only
**Risk:** CRITICAL
**Notes:** Re-assigns a social connection to a different company. Multi-tenant boundary mutation.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Requires explicit company_id in body to prevent accidental reassignment?

### POST /api/admin/maintenance/social-connections/[id]/refresh-identity
**Auth:** admin-only
**Risk:** HIGH
**Notes:** Refreshes the identity metadata for a connection from bundle.social.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Non-destructive — does not change connection state?

### POST /api/admin/maintenance/companies/[id]/toggle-cross-tenant-override
**Auth:** admin-only (super_admin only?)
**Risk:** CRITICAL
**Notes:** Bypasses cross-tenant ownership conflict for a company. Dangerous.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Requires super_admin role?
- [ ] Audit logged?

### POST /api/admin/maintenance/webhooks/replay
**Auth:** admin-only
**Risk:** HIGH
**Notes:** Replays a stored webhook event through the processor.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Idempotent insert used to prevent duplicate side effects?

---

## 18. Admin — Service Health

### GET /api/admin/service-health/events
### POST /api/admin/service-health/events
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Events queryable by severity?

### POST /api/admin/service-health/events/[id]/resolve
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Cannot resolve already-resolved event?

### POST /api/admin/service-health/flag
**Auth:** admin-only
**Risk:** MEDIUM
**Notes:** Flags a service health issue for monitoring.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Triggers alert notification?

---

## 19. Design Systems

### POST /api/design-systems/[id]/activate
**Auth:** admin-only
**Risk:** HIGH
**Notes:** Activates a design system, deactivating the current one.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Atomic swap (exactly one active at a time)?

### POST /api/design-systems/[id]/archive
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Cannot archive the currently active design system?

### GET /api/design-systems/[id]/preview
**Auth:** admin-only
**Risk:** LOW
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Returns rendered preview or preview URL?

### GET /api/design-systems/[id]/components
### POST /api/design-systems/[id]/components
### PATCH /api/design-systems/[id]/components/[cid]
### DELETE /api/design-systems/[id]/components/[cid]
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Component delete cascades correctly?

### GET /api/design-systems/[id]/templates
### POST /api/design-systems/[id]/templates
### PATCH /api/design-systems/[id]/templates/[tid]
### DELETE /api/design-systems/[id]/templates/[tid]
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Template delete rejects if referenced by active pages?

---

## 20. Briefs (Page Generation)

### POST /api/briefs/upload
**Auth:** admin-only
**Risk:** HIGH
**Notes:** Uploads a brief CSV/JSON to seed a generation batch.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] File size limit enforced?
- [ ] Validates brief schema before accepting?

### POST /api/briefs/[brief_id]/run
**Auth:** admin-only
**Risk:** CRITICAL
**Notes:** Triggers AI page generation for a brief. Consumes credits.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Budget check before run?
- [ ] Idempotent (cannot double-trigger a running brief)?

### POST /api/briefs/[brief_id]/run/snapshot
**Auth:** admin-only
**Risk:** MEDIUM
**Notes:** Snapshots current generation state for diff/audit.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Idempotent?

### POST /api/briefs/[brief_id]/cancel
**Auth:** admin-only
**Risk:** HIGH
**Notes:** Cancels an in-flight brief generation run.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Partially generated pages preserved or cleaned up?

### POST /api/briefs/[brief_id]/commit
**Auth:** admin-only
**Risk:** CRITICAL
**Notes:** Commits generated pages to the site (writes to WordPress or staging).
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Requires approval before commit?
- [ ] Idempotent on re-commit?

### GET /api/briefs/[brief_id]/pages
**Auth:** admin-only
**Risk:** LOW
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Returns all pages with current generation status?

### POST /api/briefs/[brief_id]/pages/[page_id]/approve
**Auth:** admin-only
**Risk:** HIGH
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Cannot approve a page not in `pending_review` state?

### POST /api/briefs/[brief_id]/pages/[page_id]/revise
**Auth:** admin-only
**Risk:** HIGH
**Notes:** Sends a page back for AI revision. Consumes credits.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Revision instructions validated for length?

---

## 21. Sites

### GET /api/sites/list
**Auth:** admin-only
**Risk:** LOW
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Scoped to accessible companies?

### POST /api/sites/register
**Auth:** admin-only
**Risk:** HIGH
**Notes:** Registers a new WordPress site.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Validates WordPress credentials before storing?

### POST /api/sites/test-connection
**Auth:** admin-only
**Risk:** MEDIUM
**Notes:** Tests WordPress REST API connectivity (unauthenticated probe).
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] SSRF protection on URL?

### GET /api/sites/[id]
### PATCH /api/sites/[id]
### DELETE /api/sites/[id]
**Auth:** admin-only
**Risk:** HIGH (DELETE: CRITICAL)
**RLS dependency:** `sites`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Cross-company site access blocked?
- [ ] DELETE cleans up associated pages and credentials?

### POST /api/sites/[id]/test-connection
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Uses stored credentials, not user-supplied?

### POST /api/sites/[id]/purge
**Auth:** admin-only
**Risk:** CRITICAL
**Notes:** Purges site data. Potentially destructive.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Requires explicit confirmation param?

### GET /api/sites/[id]/mode
### PATCH /api/sites/[id]/mode
**Auth:** admin-only
**Risk:** HIGH
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Switching to production mode has safeguards?

### GET /api/sites/[id]/blueprints
### POST /api/sites/[id]/blueprints
**Auth:** admin-only
**Risk:** HIGH
**RLS dependency:** `site_blueprints`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Blueprint creation validates design system reference?

### POST /api/sites/[id]/blueprints/[blueprint_id]/approve
**Auth:** admin-only
**Risk:** HIGH
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] State machine enforced (must be in pending state)?

### POST /api/sites/[id]/blueprints/[blueprint_id]/revert
**Auth:** admin-only
**Risk:** HIGH
**Notes:** Reverts a blueprint to previous state.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Previous state preserved?

### POST /api/sites/[id]/blueprints/[blueprint_id]/publish-site
**Auth:** admin-only
**Risk:** CRITICAL
**Notes:** Publishes the site to WordPress. External side effect.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Requires approved blueprint?
- [ ] Idempotent on retry?

### GET /api/sites/[id]/posts
### POST /api/sites/[id]/posts
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Scoped to the site?

### POST /api/sites/[id]/posts/[post_id]/publish
**Auth:** admin-only
**Risk:** CRITICAL
**Notes:** Publishes a post to WordPress. External side effect.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Idempotent on retry?

### POST /api/sites/[id]/posts/[post_id]/unpublish
**Auth:** admin-only
**Risk:** CRITICAL
**Notes:** Unpublishes a post from WordPress. External side effect.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Idempotent?

### POST /api/sites/[id]/posts/[post_id]/autosave
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does not change published state?

### GET /api/sites/[id]/posts/export
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] CSV/JSON format?

### POST /api/sites/[id]/ai-prefill
**Auth:** admin-only
**Risk:** HIGH
**Notes:** AI-powered prefill of site content fields. Consumes credits.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Budget check?

### GET /api/sites/[id]/appearance/preflight
### POST /api/sites/[id]/appearance/sync-palette
### POST /api/sites/[id]/appearance/rollback-palette
**Auth:** admin-only
**Risk:** HIGH
**Notes:** Design system palette sync to WordPress.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Rollback restores last-known-good palette?

### GET /api/sites/[id]/design-systems
**Auth:** admin-only
**Risk:** LOW
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Returns only active design system?

### GET /api/sites/[id]/routes
**Auth:** admin-only
**Risk:** LOW
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Returns site URL routing config?

### GET /api/sites/[id]/permalink-structure
### PATCH /api/sites/[id]/permalink-structure
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Change triggers WordPress flush?

### GET /api/sites/[id]/shared-content
### POST /api/sites/[id]/shared-content
### PATCH /api/sites/[id]/shared-content/[content_id]
### DELETE /api/sites/[id]/shared-content/[content_id]
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Shared content scoped to site?

### GET /api/sites/[id]/wp-pages
### GET /api/sites/[id]/wp-taxonomies
### GET /api/sites/[id]/wp-users
**Auth:** admin-only
**Risk:** MEDIUM
**Notes:** Proxy reads from WordPress REST API.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Uses stored credentials?
- [ ] Timeouts handled gracefully?

---

## 22. Chat (AI Page Generator)

### POST /api/chat
**Auth:** admin-only (or platform-auth?)
**Risk:** HIGH
**Notes:** Vercel AI SDK streaming endpoint. Drives the chat interface for WordPress page generation.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Prompt injection protection?
- [ ] Budget/credit check before each message?
- [ ] Site-scoped — cannot generate content for a different company's site?

---

## 23. Images (Suggest)

### POST /api/images/suggest
**Auth:** admin-only
**Risk:** MEDIUM
**Body:** `{ query: string, site_id?: string }`
**Notes:** Returns image suggestions from the library for AI-assisted content.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Scoped to accessible images only?

---

## 24. Platform — Companies

### GET /api/platform/companies/list
**Auth:** platform-auth
**Risk:** MEDIUM
**RLS dependency:** `platform_companies`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Returns only companies the user has access to?

### POST /api/platform/companies/switch
**Auth:** platform-auth
**Risk:** HIGH
**Body:** `{ company_id: string }`
**Notes:** Switches active company context in the session.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Cannot switch to a company the user has no access to?

---

## 25. Platform — Brand

### GET /api/platform/brand
### PATCH /api/platform/brand
**Auth:** platform-auth
**Risk:** MEDIUM
**RLS dependency:** `platform_companies`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Scoped to active company?

---

## 26. Platform — Notifications

### GET /api/platform/notifications
### PATCH /api/platform/notifications
**Auth:** platform-auth
**Risk:** LOW
**RLS dependency:** `platform_notifications`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Returns only the authenticated user's notifications?

---

## 27. Platform — Invitations

### GET /api/platform/invitations
### POST /api/platform/invitations
**Auth:** platform-auth
**Risk:** HIGH
**RLS dependency:** `platform_invitations`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Sender must have `manage_members` permission?

### GET /api/platform/invitations/[id]
### DELETE /api/platform/invitations/[id]
**Auth:** platform-auth
**Risk:** HIGH
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Cannot delete an accepted invitation?

### POST /api/platform/invitations/accept
**Auth:** token-gated
**Risk:** HIGH
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Token expires after acceptance?

### POST /api/platform/invitations/callbacks/expiry
### POST /api/platform/invitations/callbacks/reminder
**Auth:** cron-secret
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Expiry callback sets invitation state to expired?

---

## 28. Platform — Image Generation

### POST /api/platform/image/generate
**Auth:** platform-auth
**Risk:** HIGH
**Notes:** AI image generation. Consumes credits.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Budget check?
- [ ] Result stored in image library?

---

## 29. Platform — CAP (Content Autopilot)

### GET /api/platform/cap/subscriptions
### POST /api/platform/cap/subscriptions
**Auth:** platform-auth
**Risk:** HIGH
**RLS dependency:** `cap_subscriptions`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Scoped to company?

### GET /api/platform/cap/subscriptions/[id]
### PATCH /api/platform/cap/subscriptions/[id]
### DELETE /api/platform/cap/subscriptions/[id]
**Auth:** platform-auth
**Risk:** HIGH
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Cross-company subscription access blocked?

### GET /api/platform/cap/subscriptions/[id]/voice-profiles
### POST /api/platform/cap/subscriptions/[id]/voice-profiles
### PATCH /api/platform/cap/subscriptions/[id]/voice-profiles/[profileId]
### DELETE /api/platform/cap/subscriptions/[id]/voice-profiles/[profileId]
**Auth:** platform-auth
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Voice profiles scoped to subscription?

### POST /api/platform/cap/campaigns/[id]/generate
**Auth:** platform-auth
**Risk:** CRITICAL
**Notes:** Triggers AI campaign content generation. Consumes credits.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Budget check?
- [ ] Idempotent on retry?

### GET /api/platform/cap/campaign-posts/[id]/status
**Auth:** platform-auth
**Risk:** LOW
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Returns generation status?

### POST /api/platform/cap/campaign-posts/[id]/regenerate
**Auth:** platform-auth
**Risk:** HIGH
**Notes:** Regenerates a single campaign post. Consumes credits.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Previous content preserved until new generation completes?

### POST /api/platform/cap/campaign-posts/[id]/push
**Auth:** platform-auth
**Risk:** CRITICAL
**Notes:** Pushes a campaign post to the social publishing queue.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Validates post is in approvable state?

---

## 30. Platform — Social Connections

### GET /api/platform/social/connections
**Auth:** platform-auth
**Risk:** MEDIUM
**RLS dependency:** `social_connections`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Returns only connections for the active company?

### POST /api/platform/social/connections/connect
**Auth:** platform-auth (`manage_connections` permission)
**Risk:** CRITICAL
**Body:** `{ company_id: uuid, profile_id: uuid, platform: ProfileSocialPlatform, force_cross_tenant?: boolean }`
**Response:** `200 { url: string }` (OAuth redirect) / `409 ALREADY_CONNECTED` / `422 UPSTREAM_REJECTED`
**Notes:** Cross-tenant profile_id smuggling guard in place. L1 pre-connect ghost check runs before OAuth.
**RLS dependency:** `social_connections`, `platform_social_profiles`
**Currently tested:** none
**CURRENT BEHAVIOUR (observed in code):**
> Body includes: `company_id`, `profile_id`, `platform`, optional `force_cross_tenant`. Returns `200 { url: string }` (OAuth redirect to bundle.social) or error. Cross-tenant profile_id smuggling guard in place per code comment. Pre-connect ghost check runs before OAuth redirect per inventory notes. Guard: profile must belong to the same company as company_id.

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Profile must belong to the same company as company_id?
- [ ] Pre-ghost check runs before OAuth redirect?

### POST /api/platform/social/connections/reconnect
**Auth:** platform-auth (`manage_connections`)
**Risk:** CRITICAL
**Notes:** Re-initiates OAuth for an existing connection.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Only works on existing connections?

### GET /api/platform/social/connections/callback
**Auth:** public (OAuth callback; state param carries session context)
**Risk:** CRITICAL
**Notes:** bundle.social OAuth callback. Exchanges code for account, syncs connections.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] State/CSRF parameter validated?
- [ ] Handles `?popup=1` by sending postMessage to parent?

### POST /api/platform/social/connections/identity-preflight
**Auth:** platform-auth
**Risk:** MEDIUM
**Notes:** Checks cross-tenant ownership conflicts before connect.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Returns warning if same social identity already connected in another company?

### POST /api/platform/social/connections/sync
**Auth:** platform-auth
**Risk:** HIGH
**Notes:** Syncs DB connections with bundle.social for the company.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Idempotent?

### POST /api/platform/social/connections/[id]/disconnect
**Auth:** platform-auth (`manage_connections`)
**Risk:** CRITICAL
**Body:** none
**Response:** `200 { ok, upstream_disconnect_ok, upstream_unset_ok }` / `422 split_brain`
**Notes:** 6-step disconnect protocol: unset channel → 200ms settle → SDK disconnect → verify clean → DELETE row → audit event. Split-brain detection prevents orphaned DB rows.
**RLS dependency:** `social_connections`
**Currently tested:** none
**CURRENT BEHAVIOUR (observed in code):**
> 6-step disconnect protocol (per inventory): 1) unset channel, 2) 200ms settle, 3) SDK disconnect, 4) verify clean, 5) DELETE row, 6) audit event. Returns `200 { ok, upstream_disconnect_ok, upstream_unset_ok }` or `422 split_brain` if detection fires. Split-brain detection prevents orphaned DB rows if bundle.social still holds the account after disconnect. DB row NOT deleted if split-brain detected. Audit event written regardless of SDK errors.

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Split-brain detection fires if bundle.social still holds the account after disconnect?
- [ ] DB row NOT deleted if split-brain detected?
- [ ] Audit event written regardless of SDK errors?

### GET /api/platform/social/connections/[id]/channels
### POST /api/platform/social/connections/[id]/set-channel
### POST /api/platform/social/connections/[id]/unset-channel
**Auth:** platform-auth (`manage_connections`)
**Risk:** HIGH
**Notes:** Channel selection for Facebook Pages / YouTube Channels / LinkedIn Pages etc.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Only valid for channel-selection platforms?

### POST /api/platform/social/connections/[id]/connect-as-personal
**Auth:** platform-auth (`manage_connections`)
**Risk:** HIGH
**Notes:** Reconnects a business account as personal mode.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Audit event logged?

---

## 31. Platform — Social Drafts

### GET /api/platform/social/drafts
### POST /api/platform/social/drafts
**Auth:** platform-auth (`edit_post`)
**Risk:** HIGH
**RLS dependency:** `social_post_drafts`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] GET scoped to active company?
- [ ] POST validates draft schema?

### GET /api/platform/social/drafts/calendar-view
**Auth:** platform-auth
**Risk:** LOW
**Notes:** Returns drafts in a calendar-friendly format for the calendar view.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Scoped to company?

### POST /api/platform/social/drafts/bulk
**Auth:** platform-auth (`edit_post`)
**Risk:** HIGH
**Notes:** Bulk operations on multiple drafts.
**Currently tested:** none
**CURRENT BEHAVIOUR (observed in code):**
> File not directly read; pattern from inventory: Bulk operations endpoint. Each draft ownership validated individually. Likely accepts array of draft IDs + mutation payload (delete, reschedule, state change). Scoped to active company via RLS.

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Each draft ownership validated individually?

### GET /api/platform/social/drafts/[id]
**Auth:** platform-auth (`edit_post` on draft's company)
**Risk:** MEDIUM
**RLS dependency:** `social_post_drafts`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] 404 for archived drafts?
- [ ] Cross-company access blocked?

### PATCH /api/platform/social/drafts/[id]
**Auth:** platform-auth (`edit_post` on draft's company)
**Risk:** HIGH
**Body (V1):** `{ draft_version: number, draft_data: DraftDataSchema }`
**Body (V2):** `{ draft_version, content, media_urls, target_profile_ids, platform_variants, mode, scheduled_at?, planned_for_at?, approval_required, approver_user_id? }`
**Response:** `200 { ok, data }` / `409 VERSION_CONFLICT { current_draft }` / `422 INVALID_STATE`
**Notes:** Optimistic CAS on `draft_version` per ADR-0002. V2 body discriminated by `content` field presence.
**Currently tested:** unit (version conflict), UAT spec
**CURRENT BEHAVIOUR (observed in code):**
> `app/api/platform/social/drafts/[id]/route.ts:116-200+` — Accepts two body shapes (V1 legacy vs V2 composer). V2 discriminated by presence of `content` field. V2 schema includes: `draft_version` (optimistic CAS per ADR-0002), `content`, `media_urls`, `target_profile_ids`, `platform_variants`, `mode` (post_now|schedule|recurring|draft), `scheduled_at`, `planned_for_at`, `approval_required`, `approver_user_id`. Mode maps to state via `MODE_TO_STATE: { post_now: 'scheduled', schedule: 'scheduled', recurring: 'recurring', draft: 'draft' }`. State guard: rejects with 422 INVALID_STATE if `isTerminalForMutation(state)` (published/publishing). Optimistic CAS on `draft_version` returns 409 VERSION_CONFLICT with current_draft in error.details on conflict. V1 and V2 paths both update top-level columns + mirror into draft_data for publish compatibility.

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] VERSION_CONFLICT includes current_draft in error.details?
- [ ] Cannot PATCH published or publishing drafts (INVALID_STATE)?
- [ ] V2 path mirrors changes into draft_data for V1 publish compatibility?

### DELETE /api/platform/social/drafts/[id]
**Auth:** platform-auth (`edit_post`)
**Risk:** HIGH
**Response:** `204` / `409 CONFLICT` (published or publishing)
**Notes:** Soft-delete (sets `archived_at`). Cannot delete published/publishing drafts.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Soft-delete — record preserved with archived_at?

### POST /api/platform/social/drafts/[id]/approve
**Auth:** platform-auth
**Risk:** HIGH
**Notes:** Approver approves a draft pending review.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Only the designated approver can approve?
- [ ] State transition validated?

### POST /api/platform/social/drafts/[id]/publish
**Auth:** platform-auth
**Risk:** CRITICAL
**Notes:** Immediately publishes a draft to the social platform.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can only publish scheduled/approved drafts?
- [ ] External publish call through bundle.social?

### POST /api/platform/social/drafts/[id]/convert-to-draft
**Auth:** platform-auth
**Risk:** MEDIUM
**Notes:** Converts a scheduled draft back to draft state.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Cannot convert published/publishing drafts?

### GET /api/platform/social/drafts/[id]/analytics
**Auth:** platform-auth
**Risk:** LOW
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Returns analytics for published posts?

### POST /api/platform/social/drafts/[id]/review-link
**Auth:** platform-auth
**Risk:** MEDIUM
**Notes:** Generates or fetches a viewer review link for external approvers.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Link is time-limited?

---

## 32. Platform — Social Posts (V1 / legacy)

### GET /api/platform/social/posts
### POST /api/platform/social/posts
**Auth:** platform-auth
**Risk:** HIGH
**RLS dependency:** `social_posts` (V1 table)
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Scoped to company?

### GET /api/platform/social/posts/[id]
### PATCH /api/platform/social/posts/[id]
### DELETE /api/platform/social/posts/[id]
**Auth:** platform-auth
**Risk:** HIGH
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Cross-company access blocked?

### POST /api/platform/social/posts/bulk
**Auth:** platform-auth
**Risk:** HIGH
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Each post ownership validated?

### POST /api/platform/social/posts/[id]/submit
**Auth:** platform-auth
**Risk:** CRITICAL
**Notes:** Submits a post for approval or direct publish.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] State transition enforced?

### POST /api/platform/social/posts/[id]/approve
**Auth:** platform-auth
**Risk:** CRITICAL
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Approval triggers scheduling?

### POST /api/platform/social/posts/[id]/reject
### POST /api/platform/social/posts/[id]/request-changes
### POST /api/platform/social/posts/[id]/reopen
### POST /api/platform/social/posts/[id]/cancel-approval
**Auth:** platform-auth
**Risk:** HIGH
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] All enforce state machine transitions?

### POST /api/platform/social/posts/[id]/duplicate
**Auth:** platform-auth
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] New post starts in draft state?

### GET /api/platform/social/posts/[id]/schedule
### POST /api/platform/social/posts/[id]/schedule
### PATCH /api/platform/social/posts/[id]/schedule/[entry_id]
**Auth:** platform-auth
**Risk:** HIGH
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Schedule date must be in the future?

### GET /api/platform/social/posts/[id]/variants
**Auth:** platform-auth
**Risk:** LOW
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Returns per-platform content variants?

### GET /api/platform/social/posts/[id]/publish-attempts
**Auth:** platform-auth
**Risk:** LOW
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Returns all publish attempts (including failed) for audit?

### GET /api/platform/social/posts/[id]/recipients
### POST /api/platform/social/posts/[id]/recipients
### DELETE /api/platform/social/posts/[id]/recipients/[recipient_id]
**Auth:** platform-auth
**Risk:** HIGH
**Notes:** Approval recipients for a post.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Recipient must be a member of the company?

### POST /api/platform/social/publish-attempts/[id]/retry
**Auth:** platform-auth
**Risk:** CRITICAL
**Notes:** Retries a failed publish attempt through bundle.social.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Only works on failed attempts?
- [ ] Idempotent?

---

## 33. Platform — Social Viewer Links

### GET /api/platform/social/viewer-links
### POST /api/platform/social/viewer-links
**Auth:** platform-auth
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Links are company-scoped?

### GET /api/platform/social/viewer-links/[id]
**Auth:** token-gated (or platform-auth)
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Public viewer links do not expose company data beyond the post?

---

## 34. Platform — Social CAP Integration

### POST /api/platform/social/cap/assist
**Auth:** platform-auth
**Risk:** HIGH
**Notes:** AI-assisted content generation for social posts. Consumes credits.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Budget check?
- [ ] Prompt injection protection?

### POST /api/platform/social/cap/generate
**Auth:** platform-auth
**Risk:** CRITICAL
**Notes:** Full AI content generation via CAP. Consumes credits.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Budget/credit check?

### POST /api/platform/social/cap/generate-image
**Auth:** platform-auth
**Risk:** HIGH
**Notes:** AI image generation for social posts. Consumes credits.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Budget check?

---

## 35. Platform — Social Media

### GET /api/platform/social/media
### POST /api/platform/social/media
**Auth:** platform-auth
**Risk:** MEDIUM
**RLS dependency:** `platform_media`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Media scoped to company?

### POST /api/platform/social/media/upload
**Auth:** platform-auth
**Risk:** MEDIUM
**Notes:** Uploads media for social posts.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] File type and size limits enforced?

### GET /api/platform/social/media/image-library
**Auth:** platform-auth
**Risk:** LOW
**Notes:** Returns available images from the central image library for use in social posts.
**RLS dependency:** `images`
**Currently tested:** e2e spec (asserts `/image-library` endpoint)
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Returns only images the company is permitted to use?
- [ ] Pagination supported?

---

## 36. Platform — Social Utilities

### GET /api/platform/social/gif-search
**Auth:** platform-auth
**Risk:** LOW
**Query params:** `q: string`
**Notes:** Proxies Giphy/Tenor search.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] API key not exposed to client?

### GET /api/platform/social/gif-proxy
**Auth:** platform-auth
**Risk:** LOW
**Notes:** Proxies GIF bytes to avoid mixed-content issues.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] SSRF protection on URL param?

### POST /api/platform/social/link-preview
**Auth:** platform-auth
**Risk:** LOW
**Body:** `{ url: string }`
**Notes:** Fetches Open Graph metadata for a URL.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] SSRF protection on URL?
- [ ] Response cached?

---

## 37. Insights (Platform)

### GET /api/insights/recommendations
**Auth:** platform-auth
**Risk:** MEDIUM
**RLS dependency:** `insights_recommendations`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Scoped to company?

### POST /api/insights/recommendations/[id]/dismiss
**Auth:** platform-auth
**Risk:** LOW
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Dismiss is reversible?

### GET /api/insights/recommendations/[id]/evidence
**Auth:** platform-auth
**Risk:** LOW
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Returns supporting evidence for a recommendation?

### GET /api/insights/priors
### GET /api/insights/generation-priors
**Auth:** platform-auth
**Risk:** LOW
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Returns company-scoped priors?

### GET /api/insights/consent
### POST /api/insights/consent
**Auth:** platform-auth
**Risk:** MEDIUM
**Notes:** Cross-client insights consent management.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Consent can be revoked?

---

## 38. Optimiser

### GET /api/optimiser/clients
### POST /api/optimiser/clients
**Auth:** admin-only
**Risk:** HIGH
**RLS dependency:** `optimiser_clients`
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Client creation validates site URL?

### GET /api/optimiser/clients/[id]
### PATCH /api/optimiser/clients/[id]
**Auth:** admin-only
**Risk:** HIGH
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Cross-company client access blocked?

### POST /api/optimiser/clients/[id]/onboarded
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Marks client as fully onboarded?

### POST /api/optimiser/clients/[id]/ga4-property
**Auth:** admin-only
**Risk:** HIGH
**Notes:** Links a GA4 property to the client.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Validates property access via OAuth token?

### POST /api/optimiser/clients/[id]/ads-customer
**Auth:** admin-only
**Risk:** HIGH
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Validates customer ID format?

### POST /api/optimiser/clients/[id]/clarity
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Validates Clarity project ID?

### POST /api/optimiser/clients/[id]/cross-client-consent
**Auth:** admin-only
**Risk:** HIGH
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Consent recorded with timestamp and actor?

### POST /api/optimiser/clients/[id]/assisted-approval
**Auth:** admin-only
**Risk:** MEDIUM
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Approval triggers downstream proposal generation?

### GET /api/optimiser/clients/[id]/landing-pages
**Auth:** admin-only
**Risk:** LOW
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Returns only client's landing pages?

### GET /api/optimiser/diagnostics
**Auth:** admin-only
**Risk:** LOW
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Returns system health for the optimiser module?

### GET /api/optimiser/health
**Auth:** public (or admin-only?)
**Risk:** LOW
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Public health probe?

### GET /api/optimiser/pages/[id]/rollback
### POST /api/optimiser/pages/[id]/rollback
**Auth:** admin-only
**Risk:** CRITICAL
**Notes:** Rolls back a page variant to a previous version. External WordPress side effect.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Idempotent?

### POST /api/optimiser/pages/import
### POST /api/optimiser/landing-pages/[id]/import
**Auth:** admin-only
**Risk:** HIGH
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] SSRF protection on import URL?

### GET /api/optimiser/proposals/[id]/run-status
**Auth:** admin-only
**Risk:** LOW
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Returns async proposal generation status?

### POST /api/optimiser/proposals/[id]/approve
**Auth:** admin-only
**Risk:** CRITICAL
**Notes:** Approves an optimiser proposal, triggering variant creation in WordPress.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] State machine enforced (only pending proposals)?
- [ ] Idempotent?

### POST /api/optimiser/proposals/[id]/reject
**Auth:** admin-only
**Risk:** HIGH
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Sets proposal to rejected state?

### POST /api/optimiser/proposals/[id]/create-variant
**Auth:** admin-only
**Risk:** CRITICAL
**Notes:** Creates an A/B test variant in WordPress/Cloudflare.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Exactly one variant created per approval?

### POST /api/optimiser/proposals/[id]/rollback
**Auth:** admin-only
**Risk:** CRITICAL
**Notes:** Rolls back a deployed proposal. External side effect.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Idempotent rollback?

### GET /api/optimiser/oauth/ga4/start
### GET /api/optimiser/oauth/ga4/callback
### GET /api/optimiser/oauth/ads/start
### GET /api/optimiser/oauth/ads/callback
**Auth:** admin-only (start) / OAuth callback (callback)
**Risk:** CRITICAL
**Notes:** OAuth flows for GA4 and Google Ads. Stores refresh tokens.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] CSRF state parameter validated in callback?
- [ ] Tokens encrypted at rest?

---

## 39. Tools (WP Page Operations)

These routes are called by the AI chat agent to perform WordPress page operations.

| Route | Method | Description | Auth | Risk |
|---|---|---|---|---|
| `/api/tools/create_page` | POST | Creates a WordPress page | admin-only | CRITICAL |
| `/api/tools/update_page` | POST | Updates a WordPress page | admin-only | CRITICAL |
| `/api/tools/delete_page` | POST | Deletes a WordPress page | admin-only | CRITICAL |
| `/api/tools/publish_page` | POST | Publishes a WordPress page | admin-only | CRITICAL |
| `/api/tools/get_page` | POST | Fetches a WordPress page | admin-only | HIGH |
| `/api/tools/list_pages` | POST | Lists WordPress pages | admin-only | MEDIUM |
| `/api/tools/search_images` | POST | Searches image library | admin-only | LOW |

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] All tools validate site_id ownership before writing to WordPress?
- [ ] Tools scoped to the active site context (prevent cross-site writes)?

---

## 40. Webhooks

### POST /api/webhooks/bundlesocial
**Auth:** webhook-sig (`verifyBundlesocialSignature` — HMAC `x-signature` header)
**Risk:** CRITICAL
**Notes:** Receives all bundle.social event webhooks. Idempotent insert into `social_webhook_events`. Dispatches side effects via `processBundlesocialWebhook`.
**Response:** `200` (success + idempotent already_processed + unrecognised stored_no_action) / `401 INVALID_SIGNATURE` / `400 VALIDATION_FAILED` / `503 RECEIVER_NOT_CONFIGURED` / `500 INTERNAL_ERROR`
**Currently tested:** unit (signature verification security test)
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Wrong HMAC → 401 (no body logged)?
- [ ] Duplicate event_id → 200 already_processed (not 500)?
- [ ] Unrecognised event type → stored and 200, no side effects?

### POST /api/webhooks/qstash/social-publish
**Auth:** webhook-sig (QStash signature)
**Risk:** CRITICAL
**Notes:** QStash-delivered publish job. Executes the actual bundle.social publish call.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Signature validated before processing?
- [ ] Idempotent on duplicate delivery?

### POST /api/webhooks/qstash/social-post-history-import
**Auth:** webhook-sig (QStash signature)
**Risk:** HIGH
**Notes:** QStash-delivered job that imports historical post data.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Idempotent on duplicate delivery?

---

## 41. Utility / Infrastructure

### GET /api/health
**Auth:** public
**Risk:** LOW
**Response:** `200 { ok: true, timestamp }`
**Currently tested:** probe script
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Always returns 200 even when DB is degraded?

### POST /api/errors
**Auth:** public (client-side error reporting)
**Risk:** LOW
**Notes:** Receives client-side error reports.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Rate limited per IP?
- [ ] Does not echo back user-controlled input?

### POST /api/emergency
**Auth:** special (emergency key, not normal admin session)
**Risk:** CRITICAL
**Notes:** Emergency recovery route — bypasses normal auth. Used to recover locked-out admin accounts.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Key rotated after use?
- [ ] Audit logged?

### GET /api/debug/env-check
**Auth:** admin-only (or ops-secret?)
**Risk:** HIGH
**Notes:** Returns environment variable status for diagnostics.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does NOT expose actual secret values (only present/missing status)?

### GET /api/ops/self-probe
**Auth:** ops-secret
**Risk:** MEDIUM
**Notes:** Internal self-probe for monitoring.
**Currently tested:** probe script
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Only readable with ops secret?

### POST /api/ops/reset-admin-password
**Auth:** ops-secret
**Risk:** CRITICAL
**Notes:** Emergency admin password reset.
**Currently tested:** none
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Audit logged?

### GET /api/uat/sign-in
**Auth:** `STAGING_UAT_SECRET` + `VERCEL_BYPASS_SECRET`
**Risk:** HIGH
**Notes:** UAT harness sign-in endpoint for automated testing on staging.
**Currently tested:** UAT harness
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Not accessible on production?
- [ ] Session scoped to UAT test user only?

---

## 42. Cron Routes

All cron routes validate `CRON_SECRET` header before executing.

### Brief generation crons (CRITICAL — consume AI credits)

| Route | Method | Schedule | Risk | Tested |
|---|---|---|---|---|
| `/api/cron/process-brief-runner` | POST | Vercel cron | CRITICAL | none |
| `/api/cron/process-batch` | POST | Vercel cron | CRITICAL | none |
| `/api/cron/process-regenerations` | POST | Vercel cron | CRITICAL | none |
| `/api/cron/render-pages` | POST | Vercel cron | CRITICAL | none |

### Social publishing crons (CRITICAL — external publish side effects)

| Route | Method | Schedule | Risk | Tested |
|---|---|---|---|---|
| `/api/cron/social-publish-watchdog` | POST | Vercel cron | CRITICAL | none |
| `/api/cron/social-publish-backfill` | POST | Vercel cron | HIGH | none |
| `/api/cron/social-connections-health` | POST | Vercel cron | HIGH | none |
| `/api/cron/social-analytics-refresh` | POST | Vercel cron | HIGH | none |

### CAP crons

| Route | Method | Schedule | Risk | Tested |
|---|---|---|---|---|
| `/api/cron/cap-weekly-generation` | POST | Weekly | CRITICAL | none |
| `/api/cron/cap-monthly-generation` | POST | Monthly | CRITICAL | none |
| `/api/cron/cap-generation-runs-cleanup` | POST | Daily | MEDIUM | none |

### Optimiser crons

| Route | Method | Schedule | Risk | Tested |
|---|---|---|---|---|
| `/api/cron/optimiser-sync-ga4` | POST | Daily | HIGH | none |
| `/api/cron/optimiser-sync-ads` | POST | Daily | HIGH | none |
| `/api/cron/optimiser-sync-clarity` | POST | Daily | MEDIUM | none |
| `/api/cron/optimiser-sync-pagespeed` | POST | Daily | MEDIUM | none |
| `/api/cron/optimiser-sync-vercel-logs` | POST | Daily | MEDIUM | none |
| `/api/cron/optimiser-evaluate-pages` | POST | Daily | HIGH | none |
| `/api/cron/optimiser-score-pages` | POST | Daily | HIGH | none |
| `/api/cron/optimiser-evaluate-scores` | POST | Daily | MEDIUM | none |
| `/api/cron/optimiser-evaluate-causal-deltas` | POST | Daily | MEDIUM | none |
| `/api/cron/optimiser-extract-patterns` | POST | Weekly | HIGH | none |
| `/api/cron/optimiser-ab-monitor` | POST | Hourly | HIGH | none |
| `/api/cron/optimiser-monitor-rollouts` | POST | Hourly | HIGH | none |
| `/api/cron/optimiser-email-digest` | POST | Daily | MEDIUM | none |
| `/api/cron/optimiser-assisted-approval` | POST | Daily | HIGH | none |
| `/api/cron/optimiser-expire-proposals` | POST | Daily | MEDIUM | none |

### Insights crons

| Route | Method | Schedule | Risk | Tested |
|---|---|---|---|---|
| `/api/cron/insights-competitor-scrape` | POST | Daily | HIGH | none |
| `/api/cron/insights-feature-extract` | POST | Daily | HIGH | none |
| `/api/cron/insights-pattern-mine` | POST | Weekly | HIGH | none |
| `/api/cron/insights-recompute` | POST | Daily | HIGH | none |

### Infrastructure crons

| Route | Method | Schedule | Risk | Tested |
|---|---|---|---|---|
| `/api/cron/budget-reset` | POST | Monthly | HIGH | none |
| `/api/cron/drift-detect` | POST | Daily | HIGH | none |
| `/api/cron/extract-image-metadata` | POST | Hourly | LOW | none |
| `/api/cron/backfill-image-captions` | POST | Daily | LOW | none |
| `/api/cron/check-webhook-health` | POST | Hourly | MEDIUM | none |
| `/api/cron/dispatch-webhooks` | POST | Frequent | HIGH | none |
| `/api/cron/cost-monitoring-daily-report` | POST | Daily | MEDIUM | none |

**EXPECTED BEHAVIOUR (all cron routes, Steven to fill):**
- [ ] Missing/wrong CRON_SECRET → 401?
- [ ] Each cron is idempotent on duplicate trigger?
- [ ] Cost-consuming crons (brief runner, CAP) check budget before processing?

---

## 43. Internal Cron Routes

Lower-level internal scheduling, also `CRON_SECRET`-gated.

| Route | Method | Description | Risk | Tested |
|---|---|---|---|---|
| `/api/internal/cron/publish-due` | POST | Publishes drafts whose `scheduled_at` has passed | CRITICAL | none |
| `/api/internal/cron/escalate-approvals` | POST | Escalates overdue approval requests | HIGH | none |
| `/api/internal/cron/cleanup-cache` | POST | Cleans expired cache entries | LOW | none |
| `/api/internal/cron/health-check` | POST | Internal health probe | LOW | none |
| `/api/internal/cron/health-digest` | POST | Compiles and sends health digest | MEDIUM | none |
| `/api/internal/cron/heartbeat-check` | POST | Checks for missing cron heartbeats | MEDIUM | none |

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] `publish-due` is idempotent — does not double-publish a draft already in `publishing` state?
- [ ] `escalate-approvals` does not escalate drafts that have already been approved?

---

## Appendix: Risk summary by count

| Risk | Count (approximate) |
|---|---|
| CRITICAL | ~35 |
| HIGH | ~55 |
| MEDIUM | ~40 |
| LOW | ~20 |

## Appendix: Coverage gaps (as of 2026-05-26)

The following are untested by any automated layer:
- All optimiser OAuth routes (`/api/optimiser/oauth/*`)
- All WordPress publish/unpublish routes (`/api/sites/[id]/posts/*/publish`)
- All `emergency` and `ops/reset-admin-password` routes
- All QStash webhook routes
- All CAP crons
- All internal cron routes except where noted

Priority testing recommendation (highest risk, lowest coverage):
1. `/api/webhooks/qstash/social-publish` — CRITICAL, no sig test
2. `/api/optimiser/proposals/[id]/approve` + `/create-variant` — CRITICAL, external WP side effect
3. `/api/optimiser/oauth/*` — CRITICAL, token storage
4. `/api/sites/[id]/blueprints/[blueprint_id]/publish-site` — CRITICAL, WP write
5. `/api/cron/process-brief-runner` + `/process-batch` — CRITICAL, credit consumption
