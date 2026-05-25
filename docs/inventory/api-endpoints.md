# API Endpoints Inventory

> Generated: 2026-05-25.
> Covers every `route.ts` file discovered under `app/api/`. 230+ endpoints catalogued.
> EXPECTED BEHAVIOUR checkboxes are intentionally empty — Steven to fill.
> Risk levels: CRITICAL (auth bypass / production data mutation / spend) · HIGH (multi-tenant data / irreversible) · MEDIUM (reversible / scoped) · LOW (read-only / public).

---

## A. Authentication

### POST /api/auth/ping

**File:** `app/api/auth/ping/route.ts`
**Method(s):** POST
**Auth:** None (session probe)
**Rate limit:** None observed
**Body schema:** None
**Risk:** LOW — session status check; no state mutation

**Currently tested by:**
- Unit: None observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does this return 200 when unauthenticated (for client-side session polling)?

---

### POST /api/auth/callback

**File:** `app/api/auth/callback/route.ts`
**Method(s):** POST / GET
**Auth:** OAuth callback token in URL (no existing session required)
**Rate limit:** None observed
**Body schema:** OAuth provider callback parameters (code, state)
**Risk:** CRITICAL — exchanges OAuth code for session; incorrect handling allows session hijack

**Currently tested by:**
- Integration: `lib/__tests__/auth-callback-route.test.ts`, `lib/__tests__/auth-callback.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is PKCE enforced for the code exchange?
- [ ] Does a mismatched `state` parameter return 400 or silently fail?
- [ ] What happens when the OAuth provider returns an error code?

---

### POST /api/auth/complete-login

**File:** `app/api/auth/complete-login/route.ts`
**Method(s):** POST
**Auth:** Partial session (post-credential, pre-2FA)
**Rate limit:** None observed
**Body schema:** Login completion payload (OTP or challenge token)
**Risk:** CRITICAL — finalises authentication; incorrect implementation allows 2FA bypass

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does this endpoint enforce that a 2FA challenge was issued before accepting completion?
- [ ] Is there replay protection on the completion token?

---

### POST /api/auth/challenge-status

**File:** `app/api/auth/challenge-status/route.ts`
**Method(s):** POST
**Auth:** Partial session (mid-2FA flow)
**Rate limit:** None observed
**Body schema:** Challenge identifier
**Risk:** HIGH — exposes 2FA challenge state; could be used to enumerate challenge validity

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is the challenge status endpoint rate-limited?

---

### POST /api/auth/resend-challenge

**File:** `app/api/auth/resend-challenge/route.ts`
**Method(s):** POST
**Auth:** Partial session (mid-2FA flow)
**Rate limit:** None observed
**Body schema:** Challenge identifier
**Risk:** MEDIUM — resends 2FA code; abuse could spam user's phone/email

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is there a cooldown between resend requests?

---

### POST /api/auth/forgot-password

**File:** `app/api/auth/forgot-password/route.ts`
**Method(s):** POST
**Auth:** None (public)
**Rate limit:** None observed
**Body schema:** `{ email: string }`
**Risk:** MEDIUM — triggers password reset email; could be used to enumerate accounts or spam

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does the response differ for known vs unknown email addresses (user enumeration risk)?

---

### POST /api/auth/reset-password

**File:** `app/api/auth/reset-password/route.ts`
**Method(s):** POST
**Auth:** Reset token in body (no session required)
**Rate limit:** None observed
**Body schema:** `{ token: string, password: string }`
**Risk:** HIGH — changes account password; token validation must be strict

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is the reset token single-use?
- [ ] Does a successful reset invalidate all other active sessions?

---

### POST /api/auth/accept-invite

**File:** `app/api/auth/accept-invite/route.ts`
**Method(s):** POST
**Auth:** Invite token in body (no session required)
**Rate limit:** None observed
**Body schema:** `{ token: string, password: string }` or similar
**Risk:** HIGH — creates or links platform account; invalid token handling is security-critical

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is the invite token invalidated immediately on first use?

---

### POST /api/auth/approve-here

**File:** `app/api/auth/approve-here/route.ts`
**Method(s):** POST
**Auth:** Partial or full session
**Rate limit:** None observed
**Body schema:** Approval context
**Risk:** MEDIUM — session-based approval action

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] How does this differ from /api/approve/[token]/decision?

---

### POST /api/uat/sign-in

**File:** `app/api/uat/sign-in/route.ts`
**Method(s):** POST
**Auth:** `STAGING_UAT_SECRET` bearer token (staging-only gate)
**Rate limit:** None observed
**Body schema:** `{ email: string, secret: string }`
**Risk:** CRITICAL — bypasses normal authentication for test automation; must be completely disabled in production

**Currently tested by:**
- E2E: `e2e/uat/` specs

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is this route unreachable in production (env var absent = 403)?
- [ ] Is the `STAGING_UAT_SECRET` rotated between test runs?

---

## B. Account

### POST /api/account/change-password

**File:** `app/api/account/change-password/route.ts`
**Method(s):** POST
**Auth:** Authenticated (any role); requires current password in body
**Rate limit:** None observed
**Body schema:** `{ current_password: string, new_password: string }`
**Risk:** HIGH — credential change; incorrect current-password validation is a privilege escalation

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does a successful password change invalidate sessions on other devices?

---

### DELETE /api/account/devices/[id]

**File:** `app/api/account/devices/[id]/route.ts`
**Method(s):** DELETE
**Auth:** Authenticated; user can only delete own device sessions
**Rate limit:** None observed
**Body schema:** None
**Risk:** MEDIUM — signs out a specific device session

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can a user delete their currently active session via this endpoint?

---

### POST /api/account/devices/sign-out-others

**File:** `app/api/account/devices/sign-out-others/route.ts`
**Method(s):** POST
**Auth:** Authenticated
**Rate limit:** None observed
**Body schema:** None
**Risk:** HIGH — invalidates all sessions except current; broad device revocation

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is the current session preserved after calling this endpoint?

---

## C. Social Posts (legacy layer)

### GET/POST /api/platform/social/posts

**File:** `app/api/platform/social/posts/route.ts`
**Method(s):** GET, POST
**Auth:** GET: `view_calendar`; POST: `create_post`
**Rate limit:** None observed
**Body schema:** POST: post creation payload
**Risk:** HIGH — reads/creates social posts; tenant-scoped via RLS

**Currently tested by:**
- Integration: `lib/__tests__/social-posts.test.ts`, `lib/__tests__/social-posts-dashboard.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is the legacy POST route still used, or has all creation moved to /api/platform/social/drafts?

---

### GET/PATCH/DELETE /api/platform/social/posts/[id]

**File:** `app/api/platform/social/posts/[id]/route.ts`
**Method(s):** GET, PATCH, DELETE
**Auth:** `edit_post`; cross-tenant check via company membership
**Rate limit:** None observed
**Body schema:** PATCH: post update payload
**Risk:** HIGH — reads, mutates, or deletes a social post

**Currently tested by:**
- Integration: `lib/__tests__/social-post-transitions.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does DELETE hard-delete the post record or soft-delete?

---

### POST /api/platform/social/posts/[id]/submit

**File:** `app/api/platform/social/posts/[id]/submit/route.ts`
**Method(s):** POST
**Auth:** `edit_post`
**Rate limit:** None observed
**Body schema:** None
**Risk:** HIGH — transitions post to `pending_client_approval`; triggers approval notification

**Currently tested by:**
- Integration: `lib/__tests__/social-post-transitions.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens when the post has no `approver_user_id` set?

---

### POST /api/platform/social/posts/[id]/approve

**File:** `app/api/platform/social/posts/[id]/approve/route.ts`
**Method(s):** POST
**Auth:** `approve_post`
**Rate limit:** None observed
**Body schema:** Approval decision
**Risk:** HIGH — changes post state; triggers scheduling

**Currently tested by:**
- Integration: `lib/__tests__/social-approval-decisions.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can a post be approved by anyone with `approve_post`, or only the named approver?

---

### POST /api/platform/social/posts/[id]/reject

**File:** `app/api/platform/social/posts/[id]/reject/route.ts`
**Method(s):** POST
**Auth:** `reject_post`
**Rate limit:** None observed
**Body schema:** `{ rejection_reason: string }`
**Risk:** HIGH — state change + author notification

**Currently tested by:**
- Integration: `lib/__tests__/social-approval-decisions.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is a rejection reason required?

---

### POST /api/platform/social/posts/[id]/request-changes

**File:** `app/api/platform/social/posts/[id]/request-changes/route.ts`
**Method(s):** POST
**Auth:** `approve_post` or admin
**Rate limit:** None observed
**Body schema:** `{ changes_requested: string }`
**Risk:** HIGH — state change; author notified

**Currently tested by:**
- Integration: `lib/__tests__/social-changes-requested-notification.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is `changes_requested` stored on the post for the author to see?

---

### POST /api/platform/social/posts/[id]/cancel-approval

**File:** `app/api/platform/social/posts/[id]/cancel-approval/route.ts`
**Method(s):** POST
**Auth:** `edit_post` (author) or admin
**Rate limit:** None observed
**Body schema:** None
**Risk:** MEDIUM — reverts `pending_client_approval` back to draft

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does cancelling approval notify the approver?

---

### POST /api/platform/social/posts/[id]/duplicate

**File:** `app/api/platform/social/posts/[id]/duplicate/route.ts`
**Method(s):** POST
**Auth:** `create_post`
**Rate limit:** None observed
**Body schema:** None
**Risk:** MEDIUM — creates a copy of the post in `draft` state

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Do variants and schedule entries get duplicated with the post?

---

### POST /api/platform/social/posts/[id]/reopen

**File:** `app/api/platform/social/posts/[id]/reopen/route.ts`
**Method(s):** POST
**Auth:** `edit_post` or admin
**Rate limit:** None observed
**Body schema:** None
**Risk:** HIGH — resets a post from a terminal state back to draft

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] From which states can a post be reopened (rejected only, or also failed/published)?

---

### GET /api/platform/social/posts/[id]/publish-attempts

**File:** `app/api/platform/social/posts/[id]/publish-attempts/route.ts`
**Method(s):** GET
**Auth:** `view_calendar`
**Rate limit:** None observed
**Body schema:** None
**Risk:** MEDIUM — read-only; returns publish attempt audit history

**Currently tested by:**
- Integration: `lib/__tests__/social-publishing-list-attempts.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are error messages in failed attempts exposed to company members or only admins?

---

### POST /api/platform/social/posts/[id]/schedule

**File:** `app/api/platform/social/posts/[id]/schedule/route.ts`
**Method(s):** POST
**Auth:** `edit_post`
**Rate limit:** None observed
**Body schema:** `{ scheduled_at: string }` (ISO 8601)
**Risk:** HIGH — schedules post; triggers future publish

**Currently tested by:**
- Integration: `lib/__tests__/social-scheduling.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can a `published` post be re-scheduled?

---

### GET/DELETE /api/platform/social/posts/[id]/schedule/[entry_id]

**File:** `app/api/platform/social/posts/[id]/schedule/[entry_id]/route.ts`
**Method(s):** GET, DELETE
**Auth:** `edit_post`
**Rate limit:** None observed
**Body schema:** None
**Risk:** HIGH — DELETE removes a scheduled publish entry

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does deleting a schedule entry revert the post state from `scheduled` to `draft`?

---

### GET/POST /api/platform/social/posts/[id]/variants

**File:** `app/api/platform/social/posts/[id]/variants/route.ts`
**Method(s):** GET, POST
**Auth:** `view_calendar` (GET), `edit_post` (POST)
**Rate limit:** None observed
**Body schema:** POST: variant content payload
**Risk:** MEDIUM — creates per-platform content variant

**Currently tested by:**
- Integration: `lib/__tests__/social-variants.test.ts`, `lib/__tests__/social-variants-media.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are variants included in the approval workflow or only the master content?

---

### GET/POST /api/platform/social/posts/[id]/recipients

**File:** `app/api/platform/social/posts/[id]/recipients/route.ts`
**Method(s):** GET, POST
**Auth:** `edit_post`
**Rate limit:** None observed
**Body schema:** POST: `{ email: string }` or `{ user_id: string }`
**Risk:** HIGH — controls who receives approval notifications; PII (email addresses)

**Currently tested by:**
- Integration: `lib/__tests__/social-approval-recipients.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can recipients be external (non-platform users)?

---

### DELETE /api/platform/social/posts/[id]/recipients/[recipient_id]

**File:** `app/api/platform/social/posts/[id]/recipients/[recipient_id]/route.ts`
**Method(s):** DELETE
**Auth:** `edit_post`
**Rate limit:** None observed
**Body schema:** None
**Risk:** HIGH — removes approver from post; if removed while pending, approval workflow may stall

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens to a `pending_approval` post when all recipients are removed?

---

### POST /api/platform/social/posts/bulk

**File:** `app/api/platform/social/posts/bulk/route.ts`
**Method(s):** POST
**Auth:** `edit_post`
**Rate limit:** None observed
**Body schema:** `{ operation: string, post_ids: string[] }`
**Risk:** HIGH — bulk state mutation; large-scale irreversible operations possible

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What operations are supported (bulk delete, bulk approve, bulk cancel)?
- [ ] Is there a limit on the number of post IDs per bulk request?

---

## D. Social Drafts (V2 composer layer)

### GET /api/platform/social/drafts/calendar-view

**File:** `app/api/platform/social/drafts/calendar-view/route.ts`
**Method(s):** GET
**Auth:** `view_calendar`
**Rate limit:** None observed
**Body schema:** None; search params: `?year=&month=` or similar
**Risk:** MEDIUM — read-only calendar data; tenant-scoped

**Currently tested by:**
- Integration: `lib/__tests__/social-calendar.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What draft states are included in the calendar view response?

---

### POST /api/platform/social/drafts

**File:** `app/api/platform/social/drafts/route.ts`
**Method(s):** POST
**Auth:** Session: `create_post` permission; Service: `x-platform-service-key` + `x-platform-actor-id`
**Rate limit:** `checkPlatformRateLimit` (returns 429 on `platformRateLimitExceeded`)
**Body schema:** V2: `CreateDraftSchema` (`lib/social/schemas/create-draft.ts`) — `{ mode, content, target_profile_ids, ... }`; V1 legacy: `{ company_id }`
**Risk:** HIGH — creates a new social post draft; may immediately queue for scheduling

**Currently tested by:**
- Integration: `lib/__tests__/social-schemas.unit.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the rate limit threshold (requests per window)?
- [ ] Does the service-key auth path bypass the rate limit?
- [ ] What happens when `target_profile_ids` contains a profile that belongs to a different company?

---

### GET /api/platform/social/drafts

**File:** `app/api/platform/social/drafts/route.ts`
**Method(s):** GET
**Auth:** `view_calendar`
**Rate limit:** None observed
**Body schema:** None; search params for filtering
**Risk:** MEDIUM — read-only draft list; tenant-scoped

**Currently tested by:**
- Unit: `lib/__tests__/drafts-get.unit.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does the GET support the same `?state=` filter as the posts list?

---

### GET /api/platform/social/drafts/[id]

**File:** `app/api/platform/social/drafts/[id]/route.ts`
**Method(s):** GET
**Auth:** `edit_post`; uses service-role to load `company_id` before applying permission gate
**Rate limit:** None observed
**Body schema:** None
**Risk:** MEDIUM — loads full draft content; service-role step is intentional (needed to resolve company_id before gating)

**Currently tested by:**
- Unit: `lib/__tests__/drafts-get.unit.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens when a draft is in `published` state — is it still loadable for read?

---

### PATCH /api/platform/social/drafts/[id]

**File:** `app/api/platform/social/drafts/[id]/route.ts`
**Method(s):** PATCH
**Auth:** `edit_post`
**Rate limit:** None observed
**Body schema:** V2: `{ content, platform_variants, draft_version, ... }`; V1: `{ draft_data }` blob. CAS check on `draft_version` — mismatch returns `409 VERSION_CONFLICT`.
**Risk:** HIGH — mutates draft content; overwrites existing content; concurrent edit safety via CAS

**Currently tested by:**
- Unit: `lib/__tests__/draft-patch-v2.unit.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Which states allow PATCH (draft only, or also pending_approval / rejected)?
- [ ] Does PATCH in `pending_approval` state notify the approver that content changed?

---

### DELETE /api/platform/social/drafts/[id]

**File:** `app/api/platform/social/drafts/[id]/route.ts`
**Method(s):** DELETE
**Auth:** `edit_post`
**Rate limit:** None observed
**Body schema:** None
**Risk:** HIGH — irreversible deletion of draft and associated approval tokens

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does DELETE work on drafts in any state, or only `draft` and `rejected`?
- [ ] Are magic-link approval tokens immediately invalidated on delete?

---

### POST /api/platform/social/drafts/[id]/approve

**File:** `app/api/platform/social/drafts/[id]/approve/route.ts`
**Method(s):** POST
**Auth:** `edit_post` + must be named `approver_user_id` OR be a company admin
**Rate limit:** `checkRateLimit` applied
**Body schema:** `ApproveSchema` — `{ decision: "approved" | "rejected", rejection_reason?: string (30-500 chars when rejected) }`
**Risk:** HIGH — state transition; triggers scheduling on approve, notifications on reject

**Currently tested by:**
- Integration: `lib/__tests__/social-approval-decisions.test.ts`, `lib/__tests__/social-approver-decision-notifications.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is there a rate limit on approval decisions (to prevent replay)?
- [ ] What happens when the same approver submits two decisions in quick succession?

---

### POST /api/platform/social/drafts/[id]/convert-to-draft

**File:** `app/api/platform/social/drafts/[id]/convert-to-draft/route.ts`
**Method(s):** POST
**Auth:** `edit_post`
**Rate limit:** None observed
**Body schema:** None
**Risk:** HIGH — reverts state; cancels scheduling; may confuse a scheduled time

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does this work from `scheduled`, `rejected`, or both?
- [ ] Does this unset `scheduled_at`?

---

### POST /api/platform/social/drafts/[id]/publish

**File:** `app/api/platform/social/drafts/[id]/publish/route.ts`
**Method(s):** POST
**Auth:** `edit_post` (admin recommended)
**Rate limit:** None observed
**Body schema:** None
**Risk:** CRITICAL — manually triggers immediate publish to bundle.social; real-world side effect

**Currently tested by:**
- Integration: `lib/__tests__/social-publishing-fire.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is this restricted to admins only, or can any editor manually publish?
- [ ] Is idempotency enforced (prevents double-publish)?

---

### GET /api/platform/social/drafts/[id]/review-link

**File:** `app/api/platform/social/drafts/[id]/review-link/route.ts`
**Method(s):** GET
**Auth:** `edit_post`
**Rate limit:** None observed
**Body schema:** None
**Risk:** MEDIUM — returns magic link URL; token is sensitive but only authorises approval decision

**Currently tested by:**
- Integration: `lib/__tests__/social-viewer-links.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does calling this endpoint create a new token each time, or return an existing one?

---

### GET /api/platform/social/drafts/[id]/analytics

**File:** `app/api/platform/social/drafts/[id]/analytics/route.ts`
**Method(s):** GET
**Auth:** `view_calendar`
**Rate limit:** None observed
**Body schema:** None
**Risk:** MEDIUM — read-only post-publish analytics for the draft

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What analytics are returned (impressions, clicks, engagement)?

---

### POST /api/platform/social/drafts/bulk

**File:** `app/api/platform/social/drafts/bulk/route.ts`
**Method(s):** POST
**Auth:** `edit_post`
**Rate limit:** None observed
**Body schema:** `{ operation: string, draft_ids: string[] }`
**Risk:** HIGH — bulk delete or update; irreversible

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What bulk operations are supported?
- [ ] Is there a hard limit on the number of IDs per request?

---

## E. Social Connections

### GET /api/platform/social/connections

**File:** `app/api/platform/social/connections/route.ts`
**Method(s):** GET
**Auth:** `view_calendar`
**Rate limit:** None observed
**Body schema:** None
**Risk:** MEDIUM — lists connections; tenant-scoped

**Currently tested by:**
- Integration: `lib/__tests__/social-connections.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are `disconnected` connections included in the list response?

---

### POST /api/platform/social/connections/connect

**File:** `app/api/platform/social/connections/connect/route.ts`
**Method(s):** POST
**Auth:** `manage_connections`
**Rate limit:** None observed
**Body schema:** `{ platform: string }` — starts OAuth popup flow
**Risk:** HIGH — initiates OAuth flow; CSRF token required

**Currently tested by:**
- Integration: `lib/__tests__/social-connections-bundlesocial.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is a CSRF/state token included in the OAuth redirect?

---

### POST /api/platform/social/connections/reconnect

**File:** `app/api/platform/social/connections/reconnect/route.ts`
**Method(s):** POST
**Auth:** `reconnect_connection`
**Rate limit:** None observed
**Body schema:** `{ connection_id: string }`
**Risk:** HIGH — refreshes expired credentials; updates health status

**Currently tested by:**
- Integration: `lib/__tests__/social-reconnect-permission.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can a `disconnected` connection be reconnected via this endpoint, or does reconnect only work on `auth_required`?

---

### POST /api/platform/social/connections/identity-preflight

**File:** `app/api/platform/social/connections/identity-preflight/route.ts`
**Method(s):** POST
**Auth:** `manage_connections`
**Rate limit:** None observed
**Body schema:** Identity fingerprint payload
**Risk:** HIGH — cross-tenant identity leak defence check; validates that an OAuth identity is not already claimed by another company

**Currently tested by:**
- Integration: `lib/__tests__/social-identity-cross-tenant.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What response is returned when a cross-tenant identity conflict is detected?

---

### GET /api/platform/social/connections/[id]

**File:** `app/api/platform/social/connections/[id]/route.ts` (inferred — no route file in discovery but expected)
**Method(s):** GET
**Auth:** `view_calendar`
**Rate limit:** None observed
**Body schema:** None
**Risk:** MEDIUM — reads connection detail; tenant-scoped

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is connection health last-checked timestamp exposed in the response?

---

### POST /api/platform/social/connections/[id]/disconnect

**File:** `app/api/platform/social/connections/[id]/disconnect/route.ts`
**Method(s):** POST
**Auth:** `manage_connections`
**Rate limit:** None observed
**Body schema:** None
**Risk:** CRITICAL — disables the connection; any `scheduled` drafts targeting this connection will fail at publish time

**Currently tested by:**
- Integration: `lib/__tests__/social-connections.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does disconnect warn if there are scheduled drafts using this connection?
- [ ] Is disconnect reversible (can the connection be re-activated without re-authorising)?

---

### GET/POST /api/platform/social/connections/[id]/channels

**File:** `app/api/platform/social/connections/[id]/channels/route.ts`
**Method(s):** GET, POST
**Auth:** `manage_connections`
**Rate limit:** None observed
**Body schema:** POST: channel selection
**Risk:** MEDIUM — reads or sets channel list for a connection

**Currently tested by:**
- Contract: `lib/__tests__/social-channels.contract.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does channel list GET call bundle.social live or use a cached result?

---

### POST /api/platform/social/connections/[id]/set-channel

**File:** `app/api/platform/social/connections/[id]/set-channel/route.ts`
**Method(s):** POST
**Auth:** `manage_connections`
**Rate limit:** None observed
**Body schema:** `{ channel_id: string }`
**Risk:** HIGH — transitions connection from `pending_identity` to `healthy`; determines which page/channel is published to

**Currently tested by:**
- Integration: `lib/__tests__/social-connections-bundlesocial.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can set-channel be called on a `healthy` connection (to change channel)?

---

### POST /api/platform/social/connections/[id]/unset-channel

**File:** `app/api/platform/social/connections/[id]/unset-channel/route.ts`
**Method(s):** POST
**Auth:** `manage_connections`
**Rate limit:** None observed
**Body schema:** None
**Risk:** HIGH — reverts channel selection; connection reverts to `pending_identity`

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does unset-channel affect any scheduled drafts that are targeting this connection?

---

### POST /api/platform/social/connections/[id]/connect-as-personal

**File:** `app/api/platform/social/connections/[id]/connect-as-personal/route.ts`
**Method(s):** POST
**Auth:** `manage_connections`
**Rate limit:** None observed
**Body schema:** None
**Risk:** HIGH — sets `is_personal_mode=true`; transitions to `healthy` without channel selection (LinkedIn personal profile)

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is connect-as-personal only valid for LinkedIn connections?

---

### POST /api/platform/social/connections/callback

**File:** `app/api/platform/social/connections/callback/route.ts`
**Method(s):** POST
**Auth:** OAuth callback (state token validation)
**Rate limit:** None observed
**Body schema:** OAuth callback parameters
**Risk:** CRITICAL — OAuth callback receiver; creates new connection row; identity fingerprint checked

**Currently tested by:**
- Integration: `lib/__tests__/social-connections-bundlesocial.test.ts`, `lib/__tests__/social-identity-fingerprint.contract.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is the OAuth state parameter validated against a per-user nonce?

---

### POST /api/platform/social/connections/sync

**File:** `app/api/platform/social/connections/sync/route.ts`
**Method(s):** POST
**Auth:** `manage_connections`
**Rate limit:** None observed
**Body schema:** None
**Risk:** HIGH — reconciles local connection records with bundle.social; may update statuses

**Currently tested by:**
- Integration: `lib/__tests__/bundle-social-reconcile.unit.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does sync ever delete local connection rows that bundle.social no longer knows about?

---

## F. Social Media

### GET /api/platform/social/media

**File:** `app/api/platform/social/media/route.ts`
**Method(s):** GET
**Auth:** `view_calendar`
**Rate limit:** None observed
**Body schema:** None
**Risk:** LOW — read-only; lists company's uploaded media assets

**Currently tested by:**
- Integration: `lib/__tests__/social-media-library.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are media assets from all users in the company visible, or only the current user's?

---

### POST /api/platform/social/media/upload

**File:** `app/api/platform/social/media/upload/route.ts`
**Method(s):** POST
**Auth:** `edit_post`
**Rate limit:** None observed
**Body schema:** `multipart/form-data` with file
**Risk:** MEDIUM — stores file in Supabase Storage; file type and size validation required

**Currently tested by:**
- Integration: `lib/__tests__/social-media-upload-to-bundle.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What file types are accepted (images, video, GIFs)?
- [ ] What is the maximum file size?

---

### GET /api/platform/social/media/image-library

**File:** `app/api/platform/social/media/image-library/route.ts`
**Method(s):** GET
**Auth:** `view_calendar` (company member)
**Rate limit:** None observed
**Body schema:** None; search params: `?q=` (search), `?page=`
**Risk:** LOW — read-only; fetches images from the admin central image library for use in posts

**Currently tested by:**
- E2E: `e2e/composer-media-library-scope.spec.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are all admin images available to all company users, or is there a site-level scope?

---

## G. Social Utility

### GET/POST /api/platform/social/link-preview

**File:** `app/api/platform/social/link-preview/route.ts`
**Method(s):** GET, POST
**Auth:** `view_calendar`
**Rate limit:** None observed
**Body schema:** `{ url: string }`
**Risk:** LOW — fetches OG metadata for URL preview; SSRF consideration (URL must be validated)

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is there a safelist or blocklist of URLs that can be previewed (SSRF protection)?

---

### GET /api/platform/social/gif-search

**File:** `app/api/platform/social/gif-search/route.ts`
**Method(s):** GET
**Auth:** `view_calendar`
**Rate limit:** None observed
**Body schema:** None; search params: `?q=`
**Risk:** LOW — proxies GIF search to Giphy/Tenor; no data stored

**Currently tested by:**
- E2E: `e2e/composer-gif-attach.spec.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Which GIF provider is used (Giphy, Tenor)?

---

### GET /api/platform/social/gif-proxy

**File:** `app/api/platform/social/gif-proxy/route.ts`
**Method(s):** GET
**Auth:** `view_calendar`
**Rate limit:** None observed
**Body schema:** None; URL in query params
**Risk:** LOW — proxies GIF content to avoid CORS issues; URL validation required

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is the GIF proxy URL validated against the GIF provider domain only?

---

### GET/POST /api/platform/social/viewer-links

**File:** `app/api/platform/social/viewer-links/route.ts`
**Method(s):** GET, POST
**Auth:** `manage_invitations` (admin)
**Rate limit:** None observed
**Body schema:** POST: viewer link creation payload
**Risk:** MEDIUM — creates public-accessible links to company's schedule

**Currently tested by:**
- Integration: `lib/__tests__/social-viewer-links.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is there a maximum number of viewer links per company?

---

### DELETE /api/platform/social/viewer-links/[id]

**File:** `app/api/platform/social/viewer-links/[id]/route.ts`
**Method(s):** DELETE
**Auth:** `manage_invitations`
**Rate limit:** None observed
**Body schema:** None
**Risk:** MEDIUM — invalidates public link immediately

**Currently tested by:**
- Integration: `lib/__tests__/social-viewer-links.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is the token invalidated immediately or on next request?

---

### POST /api/platform/social/publish-attempts/[id]/retry

**File:** `app/api/platform/social/publish-attempts/[id]/retry/route.ts`
**Method(s):** POST
**Auth:** `edit_post` or admin
**Rate limit:** None observed
**Body schema:** None
**Risk:** HIGH — triggers a new publish attempt; real-world side effect

**Currently tested by:**
- Integration: `lib/__tests__/social-publishing-retry.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can any publish attempt be retried, or only `failed` ones?

---

## H. Social CAP (Content Amplification Platform)

### POST /api/platform/social/cap/generate

**File:** `app/api/platform/social/cap/generate/route.ts`
**Method(s):** POST
**Auth:** `edit_post` or CAP operator role
**Rate limit:** None observed
**Body schema:** CAP generation request
**Risk:** HIGH — incurs AI generation cost (Claude API); must check `monthly_cost_cap_usd` on `cap_subscriptions`

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is cost cap enforced before or after generation starts?
- [ ] Is there an idempotency key to prevent double-generation?

---

### POST /api/platform/social/cap/generate-image

**File:** `app/api/platform/social/cap/generate-image/route.ts`
**Method(s):** POST
**Auth:** `edit_post` or CAP operator
**Rate limit:** None observed
**Body schema:** Image generation prompt
**Risk:** HIGH — incurs AI image generation cost

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Which image generation model is used?

---

### POST /api/platform/social/cap/assist

**File:** `app/api/platform/social/cap/assist/route.ts`
**Method(s):** POST
**Auth:** `edit_post`
**Rate limit:** None observed
**Body schema:** AI assist request (content rewrite / improve)
**Risk:** HIGH — incurs AI cost; content input flows to Claude API

**Currently tested by:**
- E2E: `e2e/composer-ai-errors.spec.ts`, `e2e/composer-ai-error-categorization.spec.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is there per-user or per-company rate limiting on AI assist calls?

---

## I. Admin Users

### GET /api/admin/users/list

**File:** `app/api/admin/users/list/route.ts`
**Method(s):** GET
**Auth:** `super_admin` or `admin`
**Rate limit:** None observed
**Body schema:** None; filter/search params
**Risk:** HIGH — returns PII (user emails, roles) for all platform users

**Currently tested by:**
- Integration: `lib/__tests__/admin-users-list.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can a regular `admin` see users from all companies or only their own?

---

### POST /api/admin/users/invite

**File:** `app/api/admin/users/invite/route.ts`
**Method(s):** POST
**Auth:** `super_admin` only
**Rate limit:** None observed
**Body schema:** `{ email: string, role: string, company_id?: string }`
**Risk:** HIGH — creates invitation; grants platform access

**Currently tested by:**
- Integration: `lib/__tests__/admin-users-invite.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens when inviting an email that already has a platform account?

---

### PATCH /api/admin/users/[id]/role

**File:** `app/api/admin/users/[id]/role/route.ts`
**Method(s):** PATCH
**Auth:** `super_admin` only
**Rate limit:** None observed
**Body schema:** `{ role: string }`
**Risk:** CRITICAL — role escalation; incorrect access control allows privilege escalation

**Currently tested by:**
- Integration: `lib/__tests__/admin-users-role.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can a super_admin demote themselves?
- [ ] Is there protection against removing the last super_admin?

---

### POST /api/admin/users/[id]/revoke

**File:** `app/api/admin/users/[id]/revoke/route.ts`
**Method(s):** POST
**Auth:** `super_admin` or `admin`
**Rate limit:** None observed
**Body schema:** None
**Risk:** HIGH — immediately revokes access; all active sessions invalidated

**Currently tested by:**
- Integration: `lib/__tests__/admin-users-revoke.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are the user's active sessions invalidated immediately on revoke?

---

### POST /api/admin/users/[id]/reinstate

**File:** `app/api/admin/users/[id]/reinstate/route.ts`
**Method(s):** POST
**Auth:** `super_admin` or `admin`
**Rate limit:** None observed
**Body schema:** None
**Risk:** HIGH — restores access to a revoked user

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does reinstate restore the user's original role?

---

### GET/POST /api/admin/invites

**File:** `app/api/admin/invites/route.ts`
**Method(s):** GET, POST
**Auth:** `super_admin` or `admin`
**Rate limit:** None observed
**Body schema:** POST: invitation payload
**Risk:** HIGH — manages platform invitations

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are invitations scoped to a specific company?

---

### GET/PATCH/DELETE /api/admin/invites/[id]

**File:** `app/api/admin/invites/[id]/route.ts`
**Method(s):** GET, PATCH, DELETE
**Auth:** `super_admin` or `admin`
**Rate limit:** None observed
**Body schema:** PATCH: partial update; DELETE: revoke
**Risk:** HIGH — manages individual invitation lifecycle

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does DELETE immediately revoke the invitation, or mark it as `revoked`?

---

## J. Admin Companies

### GET/POST /api/admin/companies

**File:** `app/api/admin/companies/route.ts`
**Method(s):** GET, POST
**Auth:** `super_admin` or `admin`
**Rate limit:** None observed
**Body schema:** POST: company creation payload
**Risk:** HIGH — creates or lists companies; tenant provisioning

**Currently tested by:**
- Integration: `lib/__tests__/platform-companies.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does POST auto-provision any resources (default social profile, cap_subscription)?

---

### GET/POST /api/admin/companies/[id]/social-profiles

**File:** `app/api/admin/companies/[id]/social-profiles/route.ts`
**Method(s):** GET, POST
**Auth:** `super_admin` or `admin`
**Rate limit:** None observed
**Body schema:** POST: profile creation payload
**Risk:** HIGH — manages social profiles; tenant data

**Currently tested by:**
- Integration: `lib/__tests__/platform-social-profiles.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can a company have multiple social profiles?

---

### GET/PATCH/DELETE /api/admin/companies/[id]/social-profiles/[profileId]

**File:** `app/api/admin/companies/[id]/social-profiles/[profileId]/route.ts`
**Method(s):** GET, PATCH, DELETE
**Auth:** `super_admin` or `admin`
**Rate limit:** None observed
**Body schema:** PATCH: profile update
**Risk:** HIGH — modifies or deletes a social profile; connections may be orphaned on delete

**Currently tested by:**
- Integration: `lib/__tests__/platform-social-profiles-manage.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens to connections attributed to a profile when the profile is deleted?

---

### GET /api/admin/companies/[id]/social-profiles/[profileId]/analytics/dashboard

**File:** `app/api/admin/companies/[id]/social-profiles/[profileId]/analytics/dashboard/route.ts`
**Method(s):** GET
**Auth:** `super_admin` or `admin`
**Rate limit:** None observed
**Body schema:** None
**Risk:** LOW — read-only analytics data

**Currently tested by:**
- Unit: `lib/__tests__/analytics-dashboard-route.unit.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What analytics dimensions are returned (impressions, reach, engagement)?

---

### POST /api/admin/companies/[id]/social-profiles/[profileId]/analytics/refresh

**File:** `app/api/admin/companies/[id]/social-profiles/[profileId]/analytics/refresh/route.ts`
**Method(s):** POST
**Auth:** `super_admin` or `admin`
**Rate limit:** None observed
**Body schema:** None
**Risk:** MEDIUM — triggers analytics re-fetch from bundle.social; API call cost

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is there a cooldown on manual refreshes?

---

### POST /api/admin/companies/[id]/social-profiles/[profileId]/connect

**File:** `app/api/admin/companies/[id]/social-profiles/[profileId]/connect/route.ts`
**Method(s):** POST
**Auth:** `super_admin` or `admin`
**Rate limit:** None observed
**Body schema:** Connection parameters
**Risk:** HIGH — admin-side connection initiation for a company

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does this bypass the normal OAuth popup flow used by company users?

---

### POST /api/admin/companies/[id]/social-profiles/[profileId]/disconnect

**File:** `app/api/admin/companies/[id]/social-profiles/[profileId]/disconnect/route.ts`
**Method(s):** POST
**Auth:** `super_admin` or `admin`
**Rate limit:** None observed
**Body schema:** None
**Risk:** CRITICAL — disconnects a live connection; impacts scheduled posts for the company

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does admin disconnect warn about upcoming scheduled posts?

---

## K. Admin Images

### GET /api/admin/images/list

**File:** `app/api/admin/images/list/route.ts`
**Method(s):** GET
**Auth:** `super_admin` or `admin`
**Rate limit:** None observed
**Body schema:** None; search/filter params
**Risk:** LOW — read-only; admin image library list

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are soft-deleted images included in the list (with a filter)?

---

### POST /api/admin/images/upload

**File:** `app/api/admin/images/upload/route.ts`
**Method(s):** POST
**Auth:** `super_admin` or `admin`
**Rate limit:** None observed
**Body schema:** `multipart/form-data`
**Risk:** MEDIUM — adds image to central library; available to all company users

**Currently tested by:**
- Integration: `lib/__tests__/admin-images-id-route.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What file types and size limits apply to admin image uploads?

---

### POST /api/admin/images/check-existing

**File:** `app/api/admin/images/check-existing/route.ts`
**Method(s):** POST
**Auth:** `super_admin` or `admin`
**Rate limit:** None observed
**Body schema:** `{ url: string }` or hash-based check
**Risk:** LOW — deduplication check before upload

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What deduplication key is used (URL hash, content hash)?

---

### POST /api/admin/images/fetch-url

**File:** `app/api/admin/images/fetch-url/route.ts`
**Method(s):** POST
**Auth:** `super_admin` or `admin`
**Rate limit:** None observed
**Body schema:** `{ url: string }`
**Risk:** MEDIUM — fetches external image by URL and imports to library; SSRF consideration

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is there URL validation to prevent SSRF (only http/https, no local addresses)?

---

### GET/PATCH/DELETE /api/admin/images/[id]

**File:** `app/api/admin/images/[id]/route.ts`
**Method(s):** GET, PATCH, DELETE
**Auth:** `super_admin` or `admin`
**Rate limit:** None observed
**Body schema:** PATCH: metadata update (alt text, tags, etc.)
**Risk:** MEDIUM — manages image metadata; soft-delete on DELETE

**Currently tested by:**
- Integration: `lib/__tests__/admin-images-id-route.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is DELETE a soft-delete (tombstone) or hard-delete?

---

### GET /api/admin/images/[id]/download

**File:** `app/api/admin/images/[id]/download/route.ts`
**Method(s):** GET
**Auth:** `super_admin` or `admin`
**Rate limit:** None observed
**Body schema:** None
**Risk:** LOW — returns image file for download

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does download return a signed URL or the file directly?

---

### POST /api/admin/images/[id]/reextract

**File:** `app/api/admin/images/[id]/reextract/route.ts`
**Method(s):** POST
**Auth:** `super_admin` or `admin`
**Rate limit:** None observed
**Body schema:** None
**Risk:** MEDIUM — re-runs metadata extraction (alt text, captions) via AI; incurs cost

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does reextract overwrite existing metadata?

---

### POST /api/admin/images/[id]/restore

**File:** `app/api/admin/images/[id]/restore/route.ts`
**Method(s):** POST
**Auth:** `super_admin` or `admin`
**Rate limit:** None observed
**Body schema:** None
**Risk:** MEDIUM — undeletes a soft-deleted image

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can an image be restored after hard-delete?

---

### DELETE /api/admin/images/[id]/hard-delete

**File:** `app/api/admin/images/[id]/hard-delete/route.ts`
**Method(s):** DELETE
**Auth:** `super_admin` or `admin`
**Rate limit:** None observed
**Body schema:** None
**Risk:** HIGH — irreversible; removes image record and storage file permanently

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does hard-delete check for references to the image in other records (drafts, site pages)?

---

### DELETE /api/admin/images/bulk-hard-delete

**File:** `app/api/admin/images/bulk-hard-delete/route.ts`
**Method(s):** DELETE
**Auth:** `super_admin` or `admin`
**Rate limit:** None observed
**Body schema:** `{ image_ids: string[] }`
**Risk:** CRITICAL — bulk irreversible deletion; no undo

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is there a confirmation step or a hard limit on bulk delete size?

---

## L. Webhooks

### POST /api/webhooks/bundlesocial

**File:** `app/api/webhooks/bundlesocial/route.ts`
**Method(s):** POST
**Auth:** HMAC signature verification (`x-signature` header against `BUNDLESOCIAL_WEBHOOK_SIGNING_SECRET`) — NOT platform session auth
**Rate limit:** None (rate limiting handled at Vercel edge)
**Body schema:** `WebhookEnvelopeSchema` — `{ id: string, type: string, ... }`
**Risk:** CRITICAL — processes publish results; updates `social_post_drafts` state (`publishing → published|failed`); incorrect signature validation allows state injection

**Currently tested by:**
- Integration: `lib/__tests__/social-webhooks-bundlesocial.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens when the same webhook event ID is delivered twice (idempotency)?
- [ ] Is there a dead-letter mechanism for events that fail processing?
- [ ] What response code does a signature failure return (401 per code comments)?

---

### POST /api/webhooks/qstash/social-publish

**File:** `app/api/webhooks/qstash/social-publish/route.ts`
**Method(s):** POST
**Auth:** QStash signature verification
**Rate limit:** None
**Body schema:** QStash job payload with draft ID
**Risk:** CRITICAL — triggers social publish pipeline; external signature auth

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is QStash used as a reliable delivery layer (retries on 5xx)?

---

### POST /api/webhooks/qstash/social-post-history-import

**File:** `app/api/webhooks/qstash/social-post-history-import/route.ts`
**Method(s):** POST
**Auth:** QStash signature verification
**Rate limit:** None
**Body schema:** Import payload
**Risk:** HIGH — imports historical post data; large batch writes

**Currently tested by:**
- Unit: None independently observed

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens when a duplicate post history record is imported?

---

## M. Cron Jobs

All cron routes require `CRON_SECRET` bearer token in the `Authorization` header. Vercel invokes these on schedule; the token prevents unauthorised external triggering.

---

### POST /api/cron/process-brief-runner

**File:** `app/api/cron/process-brief-runner/route.ts`
**Risk:** CRITICAL — brief generation hot path; incurs AI cost per page; mutations to site content

---

### POST /api/cron/process-batch

**File:** `app/api/cron/process-batch/route.ts`
**Risk:** CRITICAL — batch page generation; AI cost; WP mutations

---

### POST /api/cron/process-regenerations

**File:** `app/api/cron/process-regenerations/route.ts`
**Risk:** HIGH — page regeneration queue; AI cost

---

### POST /api/cron/render-pages

**File:** `app/api/cron/render-pages/route.ts`
**Risk:** HIGH — renders pages to HTML/WP format

---

### POST /api/cron/social-publish-watchdog

**File:** `app/api/cron/social-publish-watchdog/route.ts`
**Risk:** HIGH — reconciles `in_flight` publish attempts; may update draft state to `failed`

---

### POST /api/cron/social-analytics-refresh

**File:** `app/api/cron/social-analytics-refresh/route.ts`
**Risk:** MEDIUM — refreshes social analytics from bundle.social

**Currently tested by:**
- Unit: `lib/__tests__/cron-social-analytics-refresh-route.unit.test.ts`

---

### POST /api/cron/social-connections-health

**File:** `app/api/cron/social-connections-health/route.ts`
**Risk:** HIGH — updates connection `status` based on bundle.social health check; may set `auth_required`

---

### POST /api/cron/social-publish-backfill

**File:** `app/api/cron/social-publish-backfill/route.ts`
**Risk:** HIGH — backfills post publish history from bundle.social

**Currently tested by:**
- Integration: `lib/__tests__/social-publishing-backfill.test.ts`

---

### POST /api/cron/cap-weekly-generation

**File:** `app/api/cron/cap-weekly-generation/route.ts`
**Risk:** HIGH — weekly CAP content generation; AI cost

---

### POST /api/cron/cap-monthly-generation

**File:** `app/api/cron/cap-monthly-generation/route.ts`
**Risk:** HIGH — monthly CAP content generation; AI cost

---

### POST /api/cron/cap-generation-runs-cleanup

**File:** `app/api/cron/cap-generation-runs-cleanup/route.ts`
**Risk:** MEDIUM — cleans up stale/orphaned CAP generation runs

---

### POST /api/cron/budget-reset

**File:** `app/api/cron/budget-reset/route.ts`
**Risk:** HIGH — resets monthly AI cost budget counters; incorrect reset could re-enable spend

---

### POST /api/cron/cost-monitoring-daily-report

**File:** `app/api/cron/cost-monitoring-daily-report/route.ts`
**Risk:** MEDIUM — sends daily cost summary; read-only data

---

### POST /api/cron/extract-image-metadata

**File:** `app/api/cron/extract-image-metadata/route.ts`
**Risk:** MEDIUM — runs AI metadata extraction on queued images; AI cost

---

### POST /api/cron/backfill-image-captions

**File:** `app/api/cron/backfill-image-captions/route.ts`
**Risk:** MEDIUM — AI caption backfill for existing images; AI cost

---

### POST /api/cron/drift-detect

**File:** `app/api/cron/drift-detect/route.ts`
**Risk:** MEDIUM — compares local route_registry against live WP; read-only detection

---

### POST /api/cron/dispatch-webhooks

**File:** `app/api/cron/dispatch-webhooks/route.ts`
**Risk:** MEDIUM — dispatches internal webhook events from the outbox

---

### POST /api/cron/check-webhook-health

**File:** `app/api/cron/check-webhook-health/route.ts`
**Risk:** MEDIUM — monitors webhook delivery health

---

### POST /api/cron/insights-competitor-scrape

**File:** `app/api/cron/insights-competitor-scrape/route.ts`
**Risk:** HIGH — scrapes competitor websites via Apify; external network calls; cost

---

### POST /api/cron/insights-feature-extract

**File:** `app/api/cron/insights-feature-extract/route.ts`
**Risk:** HIGH — AI feature extraction from scraped competitor content; AI cost

---

### POST /api/cron/insights-pattern-mine

**File:** `app/api/cron/insights-pattern-mine/route.ts`
**Risk:** HIGH — AI pattern mining across client content; AI cost

---

### POST /api/cron/insights-recompute

**File:** `app/api/cron/insights-recompute/route.ts`
**Risk:** HIGH — recomputes insight scores; batch DB writes

---

### POST /api/cron/optimiser-sync-ga4

**File:** `app/api/cron/optimiser-sync-ga4/route.ts`
**Risk:** MEDIUM — syncs GA4 traffic data for Optimiser clients

---

### POST /api/cron/optimiser-sync-ads

**File:** `app/api/cron/optimiser-sync-ads/route.ts`
**Risk:** MEDIUM — syncs Google Ads data for Optimiser clients

---

### POST /api/cron/optimiser-sync-clarity

**File:** `app/api/cron/optimiser-sync-clarity/route.ts`
**Risk:** MEDIUM — syncs Microsoft Clarity heatmap data

---

### POST /api/cron/optimiser-sync-pagespeed

**File:** `app/api/cron/optimiser-sync-pagespeed/route.ts`
**Risk:** MEDIUM — syncs PageSpeed Insights scores

---

### POST /api/cron/optimiser-sync-vercel-logs

**File:** `app/api/cron/optimiser-sync-vercel-logs/route.ts`
**Risk:** MEDIUM — syncs Vercel edge function logs for Optimiser analysis

---

### POST /api/cron/optimiser-evaluate-pages

**File:** `app/api/cron/optimiser-evaluate-pages/route.ts`
**Risk:** HIGH — evaluates landing pages and generates new proposals; AI cost

---

### POST /api/cron/optimiser-evaluate-scores

**File:** `app/api/cron/optimiser-evaluate-scores/route.ts`
**Risk:** MEDIUM — recalculates page scores from synced data

---

### POST /api/cron/optimiser-evaluate-causal-deltas

**File:** `app/api/cron/optimiser-evaluate-causal-deltas/route.ts`
**Risk:** HIGH — AI causal delta analysis; AI cost

---

### POST /api/cron/optimiser-score-pages

**File:** `app/api/cron/optimiser-score-pages/route.ts`
**Risk:** MEDIUM — scores pages against playbook criteria

---

### POST /api/cron/optimiser-expire-proposals

**File:** `app/api/cron/optimiser-expire-proposals/route.ts`
**Risk:** HIGH — transitions `pending` proposals to `expired` after TTL

---

### POST /api/cron/optimiser-extract-patterns

**File:** `app/api/cron/optimiser-extract-patterns/route.ts`
**Risk:** HIGH — AI pattern extraction for Optimiser playbook; AI cost

---

### POST /api/cron/optimiser-monitor-rollouts

**File:** `app/api/cron/optimiser-monitor-rollouts/route.ts`
**Risk:** HIGH — promotes or reverts staged rollouts; WP mutations

---

### POST /api/cron/optimiser-ab-monitor

**File:** `app/api/cron/optimiser-ab-monitor/route.ts`
**Risk:** HIGH — monitors A/B test results; may trigger proposal state changes

---

### POST /api/cron/optimiser-email-digest

**File:** `app/api/cron/optimiser-email-digest/route.ts`
**Risk:** MEDIUM — sends Optimiser proposal digest emails

---

### POST /api/cron/optimiser-assisted-approval

**File:** `app/api/cron/optimiser-assisted-approval/route.ts`
**Risk:** HIGH — auto-approves proposals within threshold; writes to opt_proposals state

---

### Internal Cron Routes (under /api/internal/cron/)

All require `CRON_SECRET` bearer token.

| Route | File | Risk |
|-------|------|------|
| POST /api/internal/cron/publish-due | `app/api/internal/cron/publish-due/route.ts` | CRITICAL — picks up `scheduled` drafts and fires publishing |
| POST /api/internal/cron/escalate-approvals | `app/api/internal/cron/escalate-approvals/route.ts` | HIGH — escalates overdue approval requests |
| POST /api/internal/cron/health-check | `app/api/internal/cron/health-check/route.ts` | LOW — system health probe |
| POST /api/internal/cron/health-digest | `app/api/internal/cron/health-digest/route.ts` | MEDIUM — sends health digest notifications |
| POST /api/internal/cron/heartbeat-check | `app/api/internal/cron/heartbeat-check/route.ts` | LOW — heartbeat liveness check |
| POST /api/internal/cron/cleanup-cache | `app/api/internal/cron/cleanup-cache/route.ts` | MEDIUM — purges stale cache entries |

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are all cron schedules defined in `vercel.json` or a separate cron config file?
- [ ] What happens when a cron job runs while another instance of the same job is still running?

---

## N. Approval / Public

### POST /api/approve/[token]/decision

**File:** `app/api/approve/[token]/decision/route.ts`
**Method(s):** POST
**Auth:** Token IS the auth — no platform session; token resolves via `resolveRecipientByToken()` (SHA-256 hash)
**Rate limit:** None observed
**Body schema:** `{ decision: "approved" | "rejected", rejection_reason?: string }`
**Risk:** HIGH — external-facing approval decision; invalidates token on use; author notified

**Currently tested by:**
- Integration: `lib/__tests__/approve-page-route.test.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is the decision token single-use?
- [ ] What response does the user see when they submit a decision for an already-decided request?

---

## O. Internal / Health / Tools

### GET /api/health

**File:** `app/api/health/route.ts`
**Method(s):** GET
**Auth:** None (public health probe)
**Rate limit:** None
**Body schema:** None
**Risk:** LOW — returns system health status

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What checks does the health endpoint perform (DB ping, bundle.social reachability)?

---

### GET /api/debug/env-check

**File:** `app/api/debug/env-check/route.ts`
**Method(s):** GET
**Auth:** `super_admin` session required (assumed; confirm)
**Rate limit:** None observed
**Body schema:** None
**Risk:** HIGH — exposes env var presence/absence; must never be publicly accessible

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is this endpoint gated to authenticated super_admins only?
- [ ] Should this be removed from production?

---

### POST /api/emergency

**File:** `app/api/emergency/route.ts`
**Method(s):** POST
**Auth:** Emergency secret (assumed; not independently verified)
**Rate limit:** None observed
**Body schema:** Emergency action payload
**Risk:** CRITICAL — emergency operations; must require strong authentication

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What emergency operations are available via this endpoint?
- [ ] Is the emergency secret rotated after each use?

---

### GET /api/ops/self-probe

**File:** `app/api/ops/self-probe/route.ts`
**Method(s):** GET
**Auth:** None or internal secret
**Rate limit:** None observed
**Body schema:** None
**Risk:** LOW — self-diagnostics probe

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is this called by the cron health-check or external monitoring?

---

### POST /api/ops/reset-admin-password

**File:** `app/api/ops/reset-admin-password/route.ts`
**Method(s):** POST
**Auth:** Emergency/ops secret
**Rate limit:** None observed
**Body schema:** `{ email: string, new_password: string }` (assumed)
**Risk:** CRITICAL — bypasses normal password reset flow; operational break-glass tool

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is this endpoint accessible without a platform session?
- [ ] Is there an audit trail logged when this endpoint is used?

---

### POST /api/errors

**File:** `app/api/errors/route.ts`
**Method(s):** POST
**Auth:** Authenticated (platform session) or client-side error reporter
**Rate limit:** None observed
**Body schema:** Client error report payload
**Risk:** MEDIUM — stores error reports; input from browser; could contain PII

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are error reports rate-limited to prevent flooding?

---

### POST /api/internal/error-reports

**File:** `app/api/internal/error-reports/route.ts`
**Method(s):** POST
**Auth:** Internal service key
**Rate limit:** None observed
**Body schema:** Error report payload
**Risk:** MEDIUM — internal error reporting pipeline

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] How does this differ from /api/errors?

---

## P. Sites / Briefs / Design Systems / Tools (Admin Layer)

### Admin Sites Setup

| Route | File | Method | Risk |
|-------|------|--------|------|
| POST /api/admin/sites/[id]/setup/extract | `...setup/extract/route.ts` | POST | HIGH — AI extraction from client URL |
| POST /api/admin/sites/[id]/setup/extract/save | `...extract/save/route.ts` | POST | HIGH — persists extracted design |
| POST /api/admin/sites/[id]/setup/approve-design | `...approve-design/route.ts` | POST | HIGH — approves design for generation |
| POST /api/admin/sites/[id]/setup/generate-concepts | `...generate-concepts/route.ts` | POST | HIGH — AI concept generation; cost |
| POST /api/admin/sites/[id]/setup/refine-concept | `...refine-concept/route.ts` | POST | HIGH — AI refinement; cost |
| POST /api/admin/sites/[id]/setup/extract-tone | `...extract-tone/route.ts` | POST | HIGH — AI tone extraction; cost |
| POST /api/admin/sites/[id]/setup/approve-tone | `...approve-tone/route.ts` | POST | HIGH |
| POST /api/admin/sites/[id]/setup/apply-tone | `...apply-tone/route.ts` | POST | HIGH |
| POST /api/admin/sites/[id]/setup/regenerate-tone-samples | `...regenerate-tone-samples/route.ts` | POST | HIGH — AI; cost |
| POST /api/admin/sites/[id]/setup/save-brief | `...save-brief/route.ts` | POST | HIGH |
| POST /api/admin/sites/[id]/setup/skip | `...skip/route.ts` | POST | MEDIUM |
| POST /api/admin/sites/[id]/setup/extract-design | `...extract-design/route.ts` | POST | HIGH — AI; cost |
| POST /api/admin/sites/[id]/setup/extract-screenshots | `...extract-screenshots/route.ts` | POST | HIGH — external screenshot service |

### Admin Sites Other

| Route | File | Method | Risk |
|-------|------|--------|------|
| GET/PATCH /api/admin/sites/[id]/budget | `...budget/route.ts` | GET/PATCH | HIGH — controls AI spend ceiling |
| PATCH /api/admin/sites/[id]/voice | `...voice/route.ts` | PATCH | MEDIUM |
| POST /api/admin/sites/[id]/pages/[pageId]/regenerate | `...regenerate/route.ts` | POST | HIGH — AI cost; WP mutation |
| GET/PATCH /api/admin/sites/[id]/pages/[pageId] | `...pages/[pageId]/route.ts` | GET/PATCH | HIGH |
| POST /api/admin/sites/[id]/use-image-library | `...use-image-library/route.ts` | POST | MEDIUM |

### Briefs

| Route | File | Method | Risk |
|-------|------|--------|------|
| POST /api/briefs/[brief_id]/run | `...run/route.ts` | POST | CRITICAL — triggers generation hot path |
| POST /api/briefs/[brief_id]/cancel | `...cancel/route.ts` | POST | HIGH — cancels in-flight brief run |
| POST /api/briefs/[brief_id]/commit | `...commit/route.ts` | POST | HIGH — commits generated pages to WP |
| GET/POST /api/briefs/[brief_id]/pages | `...pages/route.ts` | GET/POST | HIGH |
| POST /api/briefs/[brief_id]/pages/[page_id]/approve | `...approve/route.ts` | POST | HIGH |
| POST /api/briefs/[brief_id]/pages/[page_id]/revise | `...revise/route.ts` | POST | HIGH — AI revision; cost |
| GET /api/briefs/[brief_id]/run/snapshot | `...snapshot/route.ts` | GET | LOW — progress snapshot |
| POST /api/briefs/upload | `...upload/route.ts` | POST | HIGH — uploads brief document |

### Sites API (non-admin)

| Route | File | Method | Risk |
|-------|------|--------|------|
| GET/PATCH/DELETE /api/sites/[id] | `...route.ts` | ALL | HIGH |
| GET /api/sites/list | `...route.ts` | GET | MEDIUM |
| POST /api/sites/register | `...route.ts` | POST | HIGH — registers new WP site |
| POST /api/sites/test-connection | `...route.ts` | POST | MEDIUM — WP connection test |
| POST /api/sites/[id]/test-connection | `...route.ts` | POST | MEDIUM |
| POST /api/sites/[id]/purge | `...route.ts` | POST | HIGH — purges Cloudflare cache |
| GET/PATCH /api/sites/[id]/appearance/* | various | GET/POST | HIGH — palette sync/rollback to WP |
| GET/POST /api/sites/[id]/blueprints | `...route.ts` | ALL | HIGH |
| POST /api/sites/[id]/blueprints/[blueprint_id]/approve | | POST | HIGH |
| POST /api/sites/[id]/blueprints/[blueprint_id]/publish-site | | POST | CRITICAL — publishes to WP |
| POST /api/sites/[id]/blueprints/[blueprint_id]/revert | | POST | HIGH |
| GET/POST /api/sites/[id]/posts | `...route.ts` | ALL | HIGH |
| POST /api/sites/[id]/posts/[post_id]/publish | | POST | CRITICAL — publishes to WP |
| POST /api/sites/[id]/posts/[post_id]/unpublish | | POST | HIGH |
| POST /api/sites/[id]/posts/[post_id]/autosave | | POST | MEDIUM |
| GET /api/sites/[id]/posts/export | | GET | MEDIUM |
| GET/POST /api/sites/[id]/shared-content | `...route.ts` | ALL | HIGH |
| GET/PATCH/DELETE /api/sites/[id]/shared-content/[content_id] | | ALL | HIGH |
| GET/POST /api/sites/[id]/routes | `...route.ts` | ALL | HIGH |
| POST /api/sites/[id]/ai-prefill | `...route.ts` | POST | HIGH — AI; cost |
| GET/POST /api/sites/[id]/design-systems | `...route.ts` | ALL | HIGH |
| GET /api/sites/[id]/wp-pages | | GET | MEDIUM — live WP call |
| GET /api/sites/[id]/wp-taxonomies | | GET | MEDIUM |
| GET /api/sites/[id]/wp-users | | GET | MEDIUM |
| GET/PATCH /api/sites/[id]/permalink-structure | | ALL | HIGH |
| GET/POST /api/sites/[id]/mode | | ALL | HIGH |

### Design Systems API

| Route | File | Method | Risk |
|-------|------|--------|------|
| POST /api/design-systems/[id]/activate | `...activate/route.ts` | POST | HIGH |
| POST /api/design-systems/[id]/archive | `...archive/route.ts` | POST | HIGH |
| GET/POST /api/design-systems/[id]/components | `...route.ts` | ALL | HIGH |
| GET/PATCH/DELETE /api/design-systems/[id]/components/[cid] | `...route.ts` | ALL | HIGH |
| GET /api/design-systems/[id]/preview | `...route.ts` | GET | MEDIUM |
| GET/POST /api/design-systems/[id]/templates | `...route.ts` | ALL | HIGH |
| GET/PATCH/DELETE /api/design-systems/[id]/templates/[tid] | `...route.ts` | ALL | HIGH |

### WordPress Tools (AI agent tools)

| Route | File | Method | Risk |
|-------|------|--------|------|
| POST /api/tools/create_page | `...route.ts` | POST | CRITICAL — creates WP page; AI agent tool |
| POST /api/tools/update_page | `...route.ts` | POST | CRITICAL — updates WP page |
| POST /api/tools/delete_page | `...route.ts` | POST | CRITICAL — deletes WP page |
| GET /api/tools/get_page | `...route.ts` | GET | HIGH |
| GET /api/tools/list_pages | `...route.ts` | GET | HIGH |
| POST /api/tools/publish_page | `...route.ts` | POST | CRITICAL — publishes WP page live |
| GET /api/tools/search_images | `...route.ts` | GET | MEDIUM |

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are the /api/tools/ routes accessible to all authenticated users or restricted to the AI agent service key?
- [ ] Is there a hard rate limit on /api/tools/create_page and /api/tools/publish_page to prevent runaway generation?

---

## Q. Optimiser API

### GET/POST /api/optimiser/clients

**File:** `app/api/optimiser/clients/route.ts`
**Method(s):** GET, POST
**Auth:** `super_admin` or `admin`
**Risk:** HIGH

---

### GET/PATCH/DELETE /api/optimiser/clients/[id]

**File:** `app/api/optimiser/clients/[id]/route.ts`
**Method(s):** GET, PATCH, DELETE
**Auth:** `super_admin` or `admin`
**Risk:** HIGH

---

### Client-level Optimiser Sub-routes

| Route | File | Risk |
|-------|------|------|
| PATCH /api/optimiser/clients/[id]/ga4-property | `...ga4-property/route.ts` | HIGH |
| PATCH /api/optimiser/clients/[id]/ads-customer | `...ads-customer/route.ts` | HIGH |
| PATCH /api/optimiser/clients/[id]/clarity | `...clarity/route.ts` | HIGH |
| GET /api/optimiser/clients/[id]/landing-pages | `...landing-pages/route.ts` | MEDIUM |
| POST /api/optimiser/clients/[id]/onboarded | `...onboarded/route.ts` | HIGH |
| POST /api/optimiser/clients/[id]/assisted-approval | `...assisted-approval/route.ts` | HIGH |
| POST /api/optimiser/clients/[id]/cross-client-consent | `...cross-client-consent/route.ts` | HIGH |

### Optimiser Proposals

| Route | File | Risk |
|-------|------|------|
| POST /api/optimiser/proposals/[id]/approve | `...approve/route.ts` | HIGH — triggers brief generation |
| POST /api/optimiser/proposals/[id]/reject | `...reject/route.ts` | HIGH |
| POST /api/optimiser/proposals/[id]/rollback | `...rollback/route.ts` | HIGH — reverts WP changes |
| GET /api/optimiser/proposals/[id]/run-status | `...run-status/route.ts` | LOW |
| POST /api/optimiser/proposals/[id]/create-variant | `...create-variant/route.ts` | HIGH — A/B variant |

### Optimiser Pages / Landing Pages

| Route | File | Risk |
|-------|------|------|
| POST /api/optimiser/pages/[id]/rollback | `...rollback/route.ts` | HIGH — WP rollback |
| POST /api/optimiser/pages/import | `...route.ts` | HIGH |
| POST /api/optimiser/landing-pages/[id]/import | `...route.ts` | HIGH |

### Optimiser OAuth

| Route | File | Risk |
|-------|------|------|
| GET /api/optimiser/oauth/ga4/start | `...start/route.ts` | HIGH |
| GET /api/optimiser/oauth/ga4/callback | `...callback/route.ts` | HIGH |
| GET /api/optimiser/oauth/ads/start | `...start/route.ts` | HIGH |
| GET /api/optimiser/oauth/ads/callback | `...callback/route.ts` | HIGH |

### Optimiser Health / Diagnostics

| Route | File | Risk |
|-------|------|------|
| GET /api/optimiser/health | `...route.ts` | LOW |
| GET/POST /api/optimiser/diagnostics | `...route.ts` | MEDIUM |

---

## R. Platform Utilities

| Route | File | Method | Risk |
|-------|------|--------|------|
| GET/PATCH /api/platform/brand | `...route.ts` | ALL | HIGH — brand profile |
| GET /api/platform/companies/list | `...route.ts` | GET | MEDIUM |
| POST /api/platform/companies/switch | `...route.ts` | POST | HIGH — switches active company context in session |
| POST /api/platform/image/generate | `...route.ts` | POST | HIGH — AI image generation; cost |
| GET/POST /api/platform/invitations | `...route.ts` | ALL | HIGH |
| GET/PATCH/DELETE /api/platform/invitations/[id] | `...route.ts` | ALL | HIGH |
| POST /api/platform/invitations/accept | `...route.ts` | POST | HIGH |
| POST /api/platform/invitations/callbacks/expiry | `...route.ts` | POST | HIGH |
| POST /api/platform/invitations/callbacks/reminder | `...route.ts` | POST | MEDIUM |
| GET /api/platform/notifications | `...route.ts` | GET | LOW |

### CAP Platform Routes

| Route | File | Method | Risk |
|-------|------|--------|------|
| GET/POST /api/platform/cap/subscriptions | `...route.ts` | ALL | HIGH |
| GET/PATCH /api/platform/cap/subscriptions/[id] | `...route.ts` | ALL | HIGH |
| GET/POST /api/platform/cap/subscriptions/[id]/voice-profiles | `...route.ts` | ALL | HIGH |
| GET/PATCH/DELETE /api/platform/cap/subscriptions/[id]/voice-profiles/[profileId] | `...route.ts` | ALL | HIGH |
| POST /api/platform/cap/campaigns/[id]/generate | `...route.ts` | POST | HIGH — AI cost |
| GET /api/platform/cap/campaign-posts/[id]/status | `...route.ts` | GET | LOW |
| POST /api/platform/cap/campaign-posts/[id]/push | `...route.ts` | POST | HIGH — creates social drafts |
| POST /api/platform/cap/campaign-posts/[id]/regenerate | `...route.ts` | POST | HIGH — AI cost |

### Insights Platform Routes

| Route | File | Method | Risk |
|-------|------|--------|------|
| POST /api/insights/consent | `...route.ts` | POST | HIGH |
| GET /api/insights/recommendations | `...route.ts` | GET | MEDIUM |
| POST /api/insights/recommendations/[id]/dismiss | `...route.ts` | POST | MEDIUM |
| GET /api/insights/recommendations/[id]/evidence | `...route.ts` | GET | MEDIUM |
| GET /api/insights/priors | `...route.ts` | GET | LOW |
| GET /api/insights/generation-priors | `...route.ts` | GET | LOW |

### Admin Insights Routes

| Route | File | Method | Risk |
|-------|------|--------|------|
| POST /api/admin/insights/clients/[id]/annotate/[recId] | `...route.ts` | POST | HIGH |
| POST /api/admin/insights/clients/[id]/dismiss/[recId] | `...route.ts` | POST | MEDIUM |
| POST /api/admin/insights/clients/[id]/unsuppress/[recId] | `...route.ts` | POST | MEDIUM |
| GET/POST /api/admin/insights/clients/[id]/competitors | `...route.ts` | ALL | HIGH |
| GET/PATCH/DELETE /api/admin/insights/clients/[id]/competitors/[competitorId] | `...route.ts` | ALL | HIGH |

### Admin Maintenance Routes

| Route | File | Method | Risk |
|-------|------|--------|------|
| POST /api/admin/maintenance/reconcile-bundlesocial | `...route.ts` | POST | HIGH |
| POST /api/admin/maintenance/social-connections/[id]/reattribute | `...route.ts` | POST | HIGH |
| POST /api/admin/maintenance/social-connections/[id]/refresh-identity | `...route.ts` | POST | HIGH |
| POST /api/admin/maintenance/webhooks/replay | `...route.ts` | POST | HIGH — replays webhooks |
| POST /api/admin/maintenance/companies/[id]/toggle-cross-tenant-override | `...route.ts` | POST | CRITICAL — security boundary override |

### Admin Service Health

| Route | File | Method | Risk |
|-------|------|--------|------|
| GET/POST /api/admin/service-health/events | `...route.ts` | ALL | MEDIUM |
| POST /api/admin/service-health/events/[id]/resolve | `...route.ts` | POST | MEDIUM |
| POST /api/admin/service-health/flag | `...route.ts` | POST | MEDIUM |

### Other Admin Routes

| Route | File | Method | Risk |
|-------|------|--------|------|
| GET/PATCH /api/admin/design-system-settings | `...route.ts` | ALL | HIGH |
| GET/PATCH /api/admin/theming/[companyId] | `...route.ts` | ALL | HIGH |
| POST /api/admin/email-test | `...route.ts` | POST | MEDIUM |
| GET/POST /api/admin/batch | `...route.ts` | ALL | HIGH |
| POST /api/admin/batch/[id]/cancel | `...route.ts` | POST | HIGH |
| POST /api/admin/jobs/extract-image-metadata | `...route.ts` | POST | MEDIUM |
| POST /api/admin/media/[id]/promote | `...route.ts` | POST | HIGH |
| GET /api/admin/sites/[id]/onboarding | `...route.ts` | GET | LOW |
| POST /api/admin/sites/[id]/use-image-library | `...route.ts` | POST | MEDIUM |

### Other Platform Routes

| Route | File | Method | Risk |
|-------|------|--------|------|
| GET /api/images/suggest | `...route.ts` | GET | LOW — AI image suggestion |
| POST /api/chat | `...route.ts` | POST | HIGH — main chat interface; AI cost |

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is /api/chat restricted to admin users or accessible to all platform members?
- [ ] Does /api/platform/companies/switch require re-authentication, or is it a lightweight context switch?
- [ ] Is /api/admin/maintenance/companies/[id]/toggle-cross-tenant-override restricted to super_admin only?
