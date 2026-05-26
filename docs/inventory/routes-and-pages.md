# Routes & Pages Inventory

**Generated:** 2026-05-26  
**Source:** All `page.tsx` files under `app/`  
**Purpose:** Reference for QA, onboarding, and route-level regression coverage. Steven fills in the `EXPECTED BEHAVIOUR` checkboxes.

---

## How to read this document

- **Auth** values: `none` = no Supabase session required; `authenticated` = `getCurrentPlatformSession()` required; `role-gated` = `checkAdminAccess()` with a named role set.
- **loading.tsx** column: whether a `loading.tsx` file is colocated for suspense streaming. Only a few exist — most pages handle their own loading states inline.
- **error.tsx** / **not-found.tsx**: only the root-level files exist (`app/error.tsx`, `app/not-found.tsx`); all other pages return inline error UI.

---

## 1. Auth & Onboarding

---

### /login
**File:** `app/login/page.tsx`  
**Auth:** none (redirects already-signed-in users to `?next` or `/admin/sites`)  
**Search params:** `next` — redirect path after sign-in (sanitised: must start with `/`, no `//`)  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- `LoginForm` — email + password sign-in form
- `TAuthChrome` — centred auth page shell

**User actions on this page:**
- Enter email and password, submit to sign in
- Navigate to forgot-password (from `LoginForm` internals)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens on successful sign-in when `?next` is set?
- [ ] What happens on successful sign-in with no `?next`?
- [ ] What's shown when `FEATURE_SUPABASE_AUTH` is off?
- [ ] What happens when the auth kill switch is on?
- [ ] What happens if a stale `opollo_2fa_pending` cookie is present?
- [ ] What's the error state for wrong credentials?
- [ ] What roles can access the admin dashboard after sign-in?

---

### /login/check-email
**File:** `app/login/check-email/page.tsx`  
**Auth:** none  
**Search params:** none (likely reached after forgot-password or 2FA flow)  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Likely a static message page instructing the user to check their email

**User actions on this page:**
- Read instructions; return to `/login`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] When is this page reached?
- [ ] What message is shown?
- [ ] Is there a resend option?

---

### /auth/accept-invite
**File:** `app/auth/accept-invite/page.tsx`  
**Auth:** none (token IS the auth — validates via `?token` search param against `invites` table)  
**Search params:** `token` — raw invite token (SHA-256 hashed and matched against `invites.token_hash`)  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- `AcceptInviteForm` — password-set form for Opollo admin-side invites
- `TAuthChrome` — auth page shell
- `Alert` — shown for missing/invalid/expired/consumed tokens

**User actions on this page:**
- Set password to activate their Opollo admin account
- See error state if token is invalid, expired, or already used

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens on successful password set?
- [ ] What's shown for an invalid token?
- [ ] What's shown for an expired token?
- [ ] What's shown for an already-accepted token?
- [ ] What password rules are enforced?

---

### /invite/[token]
**File:** `app/invite/[token]/page.tsx`  
**Auth:** none (token IS the auth — path param against `platform_invitations` table)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- `PlatformAcceptInviteForm` — password + full name form for platform-layer (company) invites
- `TAuthChrome` — auth page shell
- `Alert` — shown for missing/invalid/expired/consumed/revoked tokens

**User actions on this page:**
- Set password and display name to join a company on the platform
- See error states for invalid/expired/revoked invitations

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens on successful platform invite acceptance?
- [ ] Which roles can receive platform invitations (admin/approver/editor/viewer)?
- [ ] What's the redirect after success?
- [ ] Does the page show the company name and email address?
- [ ] What happens if the token is revoked mid-flow?

---

### /auth/callback
**File:** `app/auth/callback/page.tsx`  
**Auth:** none (handles Supabase OAuth / magic-link redirect)  
**Search params:** Supabase-injected `code`, `error`, `error_description`  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Likely a redirect-only or minimal loading page

**User actions on this page:**
- None (automatic redirect after OAuth exchange)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Where does a successful callback redirect to?
- [ ] What's shown on OAuth error?
- [ ] Does this handle invite magic-links as well as OAuth?

---

### /auth/forgot-password
**File:** `app/auth/forgot-password/page.tsx`  
**Auth:** none  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Email input form for requesting a password reset link

**User actions on this page:**
- Enter email address to receive a reset link

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What feedback is shown after submitting?
- [ ] Is the response identical for known and unknown emails (to avoid enumeration)?
- [ ] Where does the reset link land the user?

---

### /auth/reset-password
**File:** `app/auth/reset-password/page.tsx`  
**Auth:** none (reset token from email link)  
**Search params:** none (Supabase session is established via the callback before landing here)  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- New password form

**User actions on this page:**
- Enter and confirm new password

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens on successful password reset?
- [ ] What's the redirect destination after reset?
- [ ] What validation is shown for mismatched or weak passwords?

---

### /auth/approve
**File:** `app/auth/approve/page.tsx`  
**Auth:** none (approval token flow)  
**Search params:** likely a token parameter  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Approval confirmation surface

**User actions on this page:**
- Confirm or decline an approval action via email link

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is being approved here (social post, site action, other)?
- [ ] What happens on approve/decline?
- [ ] What's shown for an expired or already-decided token?

---

### /auth/expired
**File:** `app/auth/expired/page.tsx`  
**Auth:** none  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Static message page

**User actions on this page:**
- Read expiry message; navigate back to sign in

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What triggers a redirect to this page?
- [ ] Is there a link back to `/login`?

---

### /auth-error
**File:** `app/auth-error/page.tsx`  
**Auth:** none  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Static error message page

**User actions on this page:**
- Read error; navigate to `/login`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What auth errors route here vs `/auth/expired`?
- [ ] What message is displayed?

---

### /account/security
**File:** `app/(platform)/account/security/page.tsx`  
**Auth:** authenticated (`getCurrentPlatformSession()`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Password change form
- 2FA settings section

**User actions on this page:**
- Change password
- Enable/disable 2FA

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Who can access this page (any authenticated user)?
- [ ] What 2FA methods are supported?
- [ ] What happens on successful password change?
- [ ] What's the error state for incorrect current password?

---

### /account/devices
**File:** `app/(platform)/account/devices/page.tsx`  
**Auth:** authenticated (`getCurrentPlatformSession()`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Device / active session list

**User actions on this page:**
- View active sessions
- Revoke individual sessions or all other devices

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What information is shown per device (IP, user agent, last active)?
- [ ] Can the current device be revoked?
- [ ] What happens after revoking a session?

---

### /approve/[token]
**File:** `app/approve/[token]/page.tsx`  
**Auth:** none (token IS the auth)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Approval form (likely for social post approval via email link, root-level variant)

**User actions on this page:**
- Approve or reject a post via tokenised link

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is this a duplicate of `/auth/approve` or a distinct flow?
- [ ] What resource is being approved?
- [ ] What's the success state?

---

### /connect/pick-channel
**File:** `app/connect/pick-channel/page.tsx`  
**Auth:** authenticated (platform session — part of social connection OAuth flow)  
**Search params:** `connection_id` — the newly-created connection needing channel selection  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Channel picker modal/form for LinkedIn orgs, Facebook pages, etc.

**User actions on this page:**
- Select which channel/page/org to publish to after OAuth completes

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Which platforms show this step (LinkedIn org, Facebook page, others)?
- [ ] What happens if no channels are available?
- [ ] Where does the user land after picking a channel?
- [ ] What's the error state if the channel pick fails?

---

## 2. Company — Social Composer & Calendar

---

### /company
**File:** `app/(platform)/company/page.tsx`  
**Auth:** authenticated (`getCurrentPlatformSession()`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- `TDashboardKpi` — dashboard shell
- `SocialPostsDashboardCard` — stats widget (drafts, pending approval, scheduled, published counts)
- `BrandCompletionBanner` — shown when brand profile is `none` or `minimal` tier and user is admin
- Quick links nav grid (Posts, Calendar, Connections, Media, Sharing, Users, Brand profile, Image generator)

**User actions on this page:**
- Navigate to any company surface via quick links
- Click "Get started" / "Continue setup" on brand completion banner
- (Opollo staff with no company) — auto-redirected to `/admin/companies`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What stats appear in the social posts card?
- [ ] When does the brand completion banner show?
- [ ] Does the image generator link appear for all editor+ users or only when a feature flag is on?
- [ ] What's shown for a viewer role with no `view_calendar` permission?
- [ ] What's the not-provisioned state for non-staff users?

---

### /company/social/calendar
**File:** `app/(platform)/company/social/calendar/page.tsx`  
**Auth:** authenticated (`getCurrentPlatformSession()`)  
**Search params:** `compose` — `?compose=new` opens the composer via URL deep-link  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- `CalendarShell` — full social dashboard: 7-column month grid, drag-and-drop reschedule, day-detail panel, bulk CSV upload, post analytics modal, timeline toggle, profile filter

**User actions on this page:**
- Navigate months
- Click a day to open day-detail panel
- Drag a post to reschedule it
- Upload a bulk CSV of posts
- Open post analytics modal
- Toggle to timeline view
- Filter by social profile
- Open composer via `?compose=new` URL param

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What states are shown on calendar tiles (draft, scheduled, published, etc.)?
- [ ] What happens when a post is dragged to a date in the past?
- [ ] What's the empty state when no connections are configured?
- [ ] What's the empty state when there are connections but no posts?
- [ ] What roles can see this page (viewer+)?
- [ ] Does DnD require editor role?
- [ ] What happens when the CSV upload contains invalid rows?

---

### /company/social/timeline
**File:** `app/(platform)/company/social/timeline/page.tsx`  
**Auth:** authenticated (`getCurrentPlatformSession()`)  
**Search params:** `page` — 1-indexed pagination (50 posts per page)  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- `TDashboardFeed` — feed shell
- `PillTabs` — Calendar / Posts / Timeline tab strip
- `TimelineFeed` — chronological card feed with pagination
- "New post" button (editor+ only)

**User actions on this page:**
- Scroll through chronological post feed
- Navigate pages via pagination
- Click "New post" (opens composer at `?compose=new`)
- Switch to Calendar or Posts tabs

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does this show all post states (including drafts and failed)?
- [ ] What's the empty state?
- [ ] What does each feed card show (text preview, platform, state pill, date)?
- [ ] Is the feed click-through to the post detail page?
- [ ] What roles can see this page?

---

## 3. Company — Social Posts & Media

---

### /company/social/posts
**File:** `app/(platform)/company/social/posts/page.tsx`  
**Auth:** authenticated (`getCurrentPlatformSession()`)  
**Search params:** `q` (search), `page` (1-indexed), `state` (filter by state), `sort` (`state_changed_at` or `created_at`), `dir` (`asc` or `desc`)  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- `TListStandard` — list page shell
- `SocialPostsListClient` — filterable, sortable posts table with pagination; includes "New post" button for editor+

**User actions on this page:**
- Search posts by text (`q`)
- Filter by state (draft, pending_client_approval, approved, rejected, changes_requested, scheduled, publishing, published, failed)
- Sort by last state change or creation date
- Paginate (25 per page)
- Click a post row to open detail page
- Click "New post" (editor+) to open composer

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What columns does the posts table show?
- [ ] What's the empty state for "no posts" vs "no results for filter"?
- [ ] Which state filter is shown by default?
- [ ] What does the "New post" affordance look like for a viewer (no `create_post`)?
- [ ] Can approvers approve directly from this list or only from the detail page?
- [ ] What happens if the list fails to load?

---

### /company/social/posts/[id]
**File:** `app/(platform)/company/social/posts/[id]/page.tsx`  
**Auth:** authenticated (`getCurrentPlatformSession()`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root) — `notFound()` called for `NOT_FOUND` error

**Major components rendered:**
- `PostDetailTabbedClient` — tabbed client wrapper receiving RSC "holes"
- `PostVariantsSection` — per-platform text variants (editable if state is draft and user has `edit_post`)
- `PostApprovalSection` — approval request details + recipients list (shown when state is `pending_client_approval`)
- `PostDecisionsAudit` — reviewer response audit trail (shown for approved/rejected/changes_requested)
- `PostScheduleSection` — schedule entries (shown when state is approved or scheduled)
- `PostPublishHistorySection` — publish attempt history (shown when state is publishing/published/failed)

**User actions on this page:**
- Read post detail and platform variants
- Edit post text (draft state, `edit_post` permission)
- Submit for approval (`submit_for_approval` permission)
- Schedule the post (`schedule_post` permission)
- Approve / reject / request changes (`approve_post` permission)
- View approval recipients and their decisions
- View publish attempt history and retry failed attempts (`schedule_post` permission)
- Delete post (from composer if wired)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What tabs does `PostDetailTabbedClient` expose?
- [ ] What's shown in the header (title, state pill, platform icons)?
- [ ] Can a reviewer approve from this page without being a platform member?
- [ ] What's the exact state machine: which actions are available per state?
- [ ] What happens when publish fails — what does the retry do?
- [ ] What's the 404 state?
- [ ] Can the post be duplicated from this page?

---

### /company/social/media
**File:** `app/(platform)/company/social/media/page.tsx`  
**Auth:** authenticated (`getCurrentPlatformSession()`)  
**Search params:** none (cursor-based pagination handled client-side)  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- `TGrid` — grid page shell
- `MediaLibraryClient` — paginated grid of media assets with upload affordance (editor+ via `canEdit`)

**User actions on this page:**
- Browse uploaded images/videos in a grid
- Upload new media asset (editor+)
- Load more via cursor pagination
- Click asset to copy ID or preview

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What asset types are supported (JPEG, PNG, MP4, etc.)?
- [ ] What's the empty state?
- [ ] What's the maximum file size?
- [ ] What does the "Add asset" affordance look like for a viewer?
- [ ] Can assets be deleted from this page?
- [ ] Does upload go to Cloudflare Images or Supabase Storage?
- [ ] What's the cursor page size?

---

### /company/social/analytics
**File:** `app/(platform)/company/social/analytics/page.tsx`  
**Auth:** authenticated (`getCurrentPlatformSession()`) + `canDo("view_calendar")`  
**Search params:** none  
**States:** loading.tsx ✓ (colocated at `app/(platform)/company/social/analytics/loading.tsx`) · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- `TDashboardKpi` — KPI dashboard shell
- `SocialAnalyticsClient` — dynamically imported (SSR disabled) analytics charts and metrics

**User actions on this page:**
- Read post performance analytics
- (Client-side interactions within `SocialAnalyticsClient`)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What metrics are shown (impressions, clicks, engagement rate, etc.)?
- [ ] What time window does the data cover?
- [ ] What's the empty state when no data has been ingested?
- [ ] What does the loading skeleton look like?
- [ ] What roles can access this page?
- [ ] Are per-platform breakdowns shown?

---

### /company/social/insights
**File:** `app/(platform)/company/social/insights/page.tsx`  
**Auth:** authenticated + `canDo("view_insights")`; users without this permission are redirected to `/company/social`  
**Search params:** `period` — one of `7d`, `30d`, `90d` (defaults to `30d`)  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- `PageShell` / `PageHeader`
- `InsightsDashboardClient` — engagement performance charts across connected accounts
- `CompetitorGapAnalysis` — competitor gap analysis panel (Suspense-wrapped)
- `PeriodSelector` — 7d / 30d / 90d toggle
- `StatusPill` — stale data warning

**User actions on this page:**
- Switch period (7d / 30d / 90d)
- Read engagement metrics across platforms
- View competitor gap analysis

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What role has `view_insights`?
- [ ] What charts/metrics are in `InsightsDashboardClient`?
- [ ] What does the competitor gap panel show?
- [ ] What's shown when data is stale?
- [ ] What's the empty state when no analytics data exists?

---

## 4. Company — Connections

---

### /company/social/connections
**File:** `app/(platform)/company/social/connections/page.tsx`  
**Auth:** authenticated (`getCurrentPlatformSession()`)  
**Search params:** `connect` (success/error/noop/sync-failed/needs_channel), `reason` (error detail code), `count` (accounts connected), `connection_id` (for auto-open channel picker), `attempted_platform` (for noop banner), `reconnect` (scroll-and-highlight connection ID)  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- `TListStandard` — list page shell
- `SocialConnectionsList` — per-profile section of connections with connect/reconnect buttons
- `ConnectBanner` — contextual success/error/noop/sync-failed banner from `?connect` param
- `Alert` — shown on load error

**User actions on this page:**
- Connect a new social account (opens bundle.social hosted portal)
- Reconnect an expired/disconnected account
- View connection status per platform
- Pick a channel after OAuth (auto-opens if `?connect=needs_channel`)
- (Admin+) Manage or remove connections

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What platforms are shown (LinkedIn, Facebook, Instagram, Google Business, Twitter/X, etc.)?
- [ ] What statuses can a connection be in?
- [ ] What's shown when no connections exist?
- [ ] What does the "Reconnect" button do?
- [ ] What error reasons are shown in the banner?
- [ ] What's the cross-tenant-blocked state?
- [ ] How are multiple profiles shown when a company has more than one?
- [ ] What happens if `emitOverdueEventsIfNeeded` finds overdue pending_identity rows?

---

### /company/social/connections/connect/[platform]
**File:** `app/(platform)/company/social/connections/connect/[platform]/page.tsx`  
**Auth:** authenticated  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Platform-specific OAuth initiation / redirect page

**User actions on this page:**
- Initiate OAuth for the specified platform (auto-redirects)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What platforms are valid `[platform]` values?
- [ ] Is this page ever visible to the user or always an immediate redirect?
- [ ] What's shown if the platform is unsupported?

---

## 5. Company — Settings & Users

---

### /company/settings/brand
**File:** `app/(platform)/company/settings/brand/page.tsx`  
**Auth:** authenticated  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Brand profile settings form (primary colour, logo, industry, tone of voice, focus topics)

**User actions on this page:**
- Set or update brand profile fields
- Upload logo

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What fields are on the brand form?
- [ ] What tier does the brand profile reach at each completion level (none / minimal / full)?
- [ ] Who can edit brand settings (admin only)?
- [ ] What's the save confirmation pattern?
- [ ] Does changing the brand profile affect existing posts?

---

### /company/settings/insights
**File:** `app/(platform)/company/settings/insights/page.tsx`  
**Auth:** authenticated  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Insights configuration settings (competitor tracking, data consent, etc.)

**User actions on this page:**
- Configure which competitors to track
- Toggle cross-client learning consent

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What settings are available?
- [ ] Who can change insights settings?
- [ ] What's the default/empty state?

---

### /company/social/sharing
**File:** `app/(platform)/company/social/sharing/page.tsx`  
**Auth:** authenticated + `canDo("manage_invitations")` (admin only); non-admins see an "Admins only" alert  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- `TSettingsFlat` — flat settings page shell
- `ViewerLinksManager` — list of viewer links with create/revoke actions

**User actions on this page:**
- Mint a new 90-day read-only calendar link
- Copy a viewer link URL
- Revoke an existing viewer link

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] How many viewer links can a company have?
- [ ] What does a viewer link URL look like?
- [ ] What's shown in the table per link (label, created date, expires, last used)?
- [ ] What happens after revoking — is it immediate?
- [ ] What's the empty state (no links yet)?

---

### /company/users
**File:** `app/(platform)/company/users/page.tsx`  
**Auth:** authenticated  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Platform user management: member list, pending invitations, invite button

**User actions on this page:**
- View company members and their roles
- Invite new members (admin only via `manage_invitations`)
- View/revoke pending invites (admin only)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What columns are shown per member (email, name, role, status)?
- [ ] Can roles be changed inline on this page?
- [ ] What roles can a company admin invite (admin/approver/editor/viewer)?
- [ ] What's the empty state?
- [ ] Can members be removed from this page?

---

### /company/image/generate
**File:** `app/(platform)/company/image/generate/page.tsx`  
**Auth:** authenticated + `create_post` permission + `IMAGE_FEATURE_MOOD_BOARD=true` feature flag  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- AI image generation interface (mood board backgrounds for social posts)

**User actions on this page:**
- Enter a prompt to generate mood board background images
- Select and save a generated image to the media library

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Which AI image model is used?
- [ ] How many images are generated per request?
- [ ] What happens when the feature flag is off?
- [ ] What are the size/format constraints for generated images?
- [ ] Does the image land in the company media library automatically?

---

### /company/internal/autosave-lab
**File:** `app/(platform)/company/internal/autosave-lab/page.tsx`  
**Auth:** authenticated (internal dev page)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Autosave testing lab (internal/dev only)

**User actions on this page:**
- Test autosave behaviour in isolation

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Should this page be accessible in production?
- [ ] Is there a role gate on this page?

---

## 6. Admin — Sites

---

### /admin/sites
**File:** `app/(platform)/admin/sites/page.tsx`  
**Auth:** role-gated (`checkAdminAccess()` — `super_admin` or `admin`)  
**Search params:** `status` (active/pending_pairing/paused/removed), `sort` (column), `dir` (asc/desc)  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- `TListStandard` — list page shell
- `SitesListClient` — sortable/filterable table of WordPress sites; includes three-dot menus with delete option for `super_admin` only
- "New site" button → `/admin/sites/new`

**User actions on this page:**
- Filter sites by status
- Sort sites by column
- Click a site to go to `/admin/sites/[id]`
- Click "New site" to create
- Archive, pause, or (super_admin) purge a site from the row menu

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What columns are shown in the sites table?
- [ ] What statuses does the filter support?
- [ ] What's the empty state (no sites)?
- [ ] What does "purge" do vs "archive"?
- [ ] What's the difference between admin and super_admin access on this page?

---

### /admin/sites/new
**File:** `app/(platform)/admin/sites/new/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- New site creation form (name, WordPress URL, credentials)

**User actions on this page:**
- Enter site name, WP URL, and API credentials to add a new site

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What fields are required?
- [ ] What validation is performed on the WP URL?
- [ ] What happens on successful creation (redirect to site detail)?
- [ ] Are WP credentials validated against the live site on creation?

---

### /admin/sites/[id]
**File:** `app/(platform)/admin/sites/[id]/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root) — `notFound()` for `NOT_FOUND`

**Major components rendered:**
- `TDetailSummary` — detail page shell with sidebar
- `SiteDetailActions` — three-dot menu (edit, archive, run batch)
- `TenantBudgetBadge` + `EditTenantBudgetButton` (admin+) — budget sidebar card
- `OnboardingReminderBanner` — when site mode is null
- `SetupReminderBanner` — when new_design mode is selected but setup not started
- `BlogStyleCalibrationBanner` — when blog styling not calibrated
- Recent batches table (links to `/admin/batches/[siteId]`)
- Briefs table with `UploadBriefButton`
- Design system sidebar card (mode-aware: copy_existing / new_design / DS active)
- Appearance, Site Plan, Shared Content, Settings sidebar links

**User actions on this page:**
- Click batch row to open batch detail
- Click "View all" to see full batch list for this site
- Upload a brief
- Click brief row to review
- Edit tenant budget (admin+)
- Navigate to design system, appearance, blueprints, content, settings
- Run a batch via three-dot menu
- Archive/edit the site via three-dot menu

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What site statuses are shown as pills?
- [ ] What triggers the onboarding reminder banner?
- [ ] What triggers the blog style calibration banner?
- [ ] How many recent batches are shown (currently 20)?
- [ ] What's the "Run batch" flow from the three-dot menu?
- [ ] What happens when a brief parse fails?
- [ ] What's shown in the design system card for each mode?

---

### /admin/sites/[id]/edit
**File:** `app/(platform)/admin/sites/[id]/edit/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Site edit form (name, WP URL, credential update)

**User actions on this page:**
- Update site name, WP URL, or credentials

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What fields can be changed after creation?
- [ ] Does editing WP URL re-validate connectivity?
- [ ] What's the redirect on save?

---

### /admin/sites/[id]/onboarding
**File:** `app/(platform)/admin/sites/[id]/onboarding/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Site mode selection: Copy existing site vs New design

**User actions on this page:**
- Choose site mode (`copy_existing` or `new_design`)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What does each mode unlock?
- [ ] Can the mode be changed after selection?
- [ ] What's the next step after picking a mode?

---

### /admin/sites/[id]/setup
**File:** `app/(platform)/admin/sites/[id]/setup/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Design setup wizard for `new_design` mode (brand voice, tone of voice, design direction)

**User actions on this page:**
- Complete the design setup wizard steps
- Approve the design direction

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What steps are in the wizard?
- [ ] What's the completion state?
- [ ] What gets unlocked after setup approval?

---

### /admin/sites/[id]/setup/extract
**File:** `app/(platform)/admin/sites/[id]/setup/extract/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Design extraction tool for `copy_existing` mode (extracts colours, fonts from existing WP site)

**User actions on this page:**
- Run design extraction from the live WP site
- Edit extracted design profile

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What does extraction scrape from the WP site?
- [ ] How long does extraction take?
- [ ] What's shown after extraction completes?
- [ ] Can extraction be re-run?

---

### /admin/sites/[id]/design-system
**File:** `app/(platform)/admin/sites/[id]/design-system/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Design system overview (version, status, activation date, linked templates)

**User actions on this page:**
- View active design system
- Navigate to components, templates, preview
- Create a new design system version

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What's shown when no design system exists?
- [ ] Can only one DS be active at a time?
- [ ] What triggers DS version increment?

---

### /admin/sites/[id]/design-system/components
**File:** `app/(platform)/admin/sites/[id]/design-system/components/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Component library for the active design system

**User actions on this page:**
- Browse and manage design system components

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is a "component" in this context?
- [ ] Can components be created/edited from this page?

---

### /admin/sites/[id]/design-system/templates
**File:** `app/(platform)/admin/sites/[id]/design-system/templates/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Templates list for the active design system (page types: service, location, blog, etc.)

**User actions on this page:**
- View templates (name, page_type, is_default)
- Navigate to a template to edit

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What page types exist?
- [ ] What does "default" mean for a template?
- [ ] Can templates be created from this page?

---

### /admin/sites/[id]/design-system/preview
**File:** `app/(platform)/admin/sites/[id]/design-system/preview/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Live preview renderer for a design system template

**User actions on this page:**
- Preview how a generated page would look

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can the user switch between templates in the preview?
- [ ] Is the preview a live iframe or a static render?

---

### /admin/sites/[id]/appearance
**File:** `app/(platform)/admin/sites/[id]/appearance/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Kadence palette sync panel (syncs active DS palette to WordPress/Kadence)

**User actions on this page:**
- Sync design system palette to the live WordPress site via Kadence

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What does a successful sync look like?
- [ ] What's the error state when the WP site is unreachable?
- [ ] How does the palette map to Kadence colour slots?

---

### /admin/sites/[id]/blueprints/review
**File:** `app/(platform)/admin/sites/[id]/blueprints/review/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Site Plan (blueprint) review and approval interface

**User actions on this page:**
- Review AI-generated page blueprint
- Approve or request changes to the site plan
- Navigate to individual blueprint pages

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What does a blueprint contain per page?
- [ ] What happens after the blueprint is approved?
- [ ] Can individual pages in the plan be removed?

---

### /admin/sites/[id]/content
**File:** `app/(platform)/admin/sites/[id]/content/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Shared Content Manager (CTAs, testimonials, FAQ items)

**User actions on this page:**
- View/edit shared content objects
- Add new CTAs, testimonials, FAQ items

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What content types are supported?
- [ ] How are shared content objects referenced in batch generation?
- [ ] What's the empty state?

---

### /admin/sites/[id]/settings
**File:** `app/(platform)/admin/sites/[id]/settings/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Site-level settings: brand voice and design direction defaults

**User actions on this page:**
- Set/edit brand voice for the site
- Set/edit design direction defaults

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Do site-level settings override or inform brief-level settings?
- [ ] What's shown when neither field is set ("Not set" pill on site detail)?

---

### /admin/sites/[id]/pages
**File:** `app/(platform)/admin/sites/[id]/pages/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Generated pages list for the site

**User actions on this page:**
- Browse generated WordPress pages
- Navigate to individual page detail

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What data is shown per page (slug, WP ID, state, template)?
- [ ] Is there a link to the live WP page?

---

### /admin/sites/[id]/pages/[pageId]
**File:** `app/(platform)/admin/sites/[id]/pages/[pageId]/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Generated page detail (content, metadata, generation history)

**User actions on this page:**
- View generated page content
- Re-generate the page
- View generation attempt history

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What's shown in the page detail?
- [ ] Can the content be edited inline or only re-generated?

---

### /admin/sites/[id]/posts
**File:** `app/(platform)/admin/sites/[id]/posts/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Blog posts list for this site

**User actions on this page:**
- Browse blog posts for the site
- Create a new post

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is this for WP blog posts or social posts?
- [ ] What columns are shown?

---

### /admin/sites/[id]/posts/new
**File:** `app/(platform)/admin/sites/[id]/posts/new/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- New WP blog post creation form

**User actions on this page:**
- Create a new blog post for the site

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What fields are on the new post form?
- [ ] Is AI generation available from here?

---

### /admin/sites/[id]/posts/[post_id]
**File:** `app/(platform)/admin/sites/[id]/posts/[post_id]/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Blog post detail / editor

**User actions on this page:**
- View and edit a WP blog post

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is there a publish action from this page?
- [ ] Can content be re-generated?

---

### /admin/sites/[id]/briefs/[brief_id]/review
**File:** `app/(platform)/admin/sites/[id]/briefs/[brief_id]/review/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Brief review page: parsed page list, brief metadata

**User actions on this page:**
- Review parsed pages from a brief
- Approve or reject individual pages
- Commit the brief to trigger batch generation

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What states can a brief be in (parsing/parsed/committed/failed_parse)?
- [ ] What does "commit" trigger?
- [ ] Can individual pages be removed from the brief before committing?

---

### /admin/sites/[id]/briefs/[brief_id]/run
**File:** `app/(platform)/admin/sites/[id]/briefs/[brief_id]/run/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Brief run configuration and execution page

**User actions on this page:**
- Configure and trigger batch run from a brief

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What parameters can be configured before running?
- [ ] Does this create a `generation_job`?

---

## 7. Admin — Batches & Posts

---

### /admin/batches
**File:** `app/(platform)/admin/batches/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Cross-site batch list (all sites, all operators)

**User actions on this page:**
- Browse all batches across sites
- Navigate to a site-specific batch list

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What columns are shown?
- [ ] Is there filtering by site or status?
- [ ] What's the default sort order?

---

### /admin/batches/[siteId]
**File:** `app/(platform)/admin/batches/[siteId]/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Batch list for a specific site

**User actions on this page:**
- Browse all batches for the site
- Navigate to a batch detail

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is the list paginated?
- [ ] Are batches from all operators shown to all admins?

---

### /admin/batches/[siteId]/[batchId]
**File:** `app/(platform)/admin/batches/[siteId]/[batchId]/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- `TDetailSummary` — detail shell
- `BatchDetailClient` — cancel/refresh controls for the job
- `BatchSuccessMoment` — shown when job status is `succeeded`
- Slots table (per-page generation status, cost, WP page ID, errors)
- Recent events sidebar (last 20 `generation_events`)

**User actions on this page:**
- Monitor slot-level generation progress
- Cancel an in-progress batch (`BatchDetailClient`)
- View per-slot errors and retry counts
- Navigate to the live WP page for a successful slot

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does this page auto-refresh while the batch is running?
- [ ] What does the `BatchSuccessMoment` show?
- [ ] Can individual failed slots be retried?
- [ ] What does "Cancel" do — stops the queue or marks it cancelled?
- [ ] What's the access restriction for non-creator admins (currently shows "belongs to another operator")?

---

### /admin/posts
**File:** `app/(platform)/admin/posts/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Admin-level posts list (cross-site)

**User actions on this page:**
- Browse all WP blog posts across sites
- Navigate to a post detail or new post form

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is this WP blog posts or social posts?
- [ ] What filtering is available?

---

### /admin/posts/new
**File:** `app/(platform)/admin/posts/new/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- New admin-level post creation form

**User actions on this page:**
- Create a new blog post (site selection required)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is a site selector shown on this form (vs `/admin/posts/[siteId]/new` which already has the site)?

---

### /admin/posts/[siteId]/new
**File:** `app/(platform)/admin/posts/[siteId]/new/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- New blog post form pre-scoped to a site

**User actions on this page:**
- Create a new WP blog post for the specified site

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What's the difference from `/admin/posts/new`?

---

## 8. Admin — Companies & CAP

---

### /admin/companies
**File:** `app/(platform)/admin/companies/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Companies list table (name, slug, member count, domain)
- "New company" button → `/admin/companies/new`

**User actions on this page:**
- Browse all platform companies
- Create a new company
- Navigate to company detail

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What columns are in the companies table?
- [ ] Is there search/filter?
- [ ] What's the empty state?

---

### /admin/companies/new
**File:** `app/(platform)/admin/companies/new/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- New company creation form (name, slug, domain)

**User actions on this page:**
- Create a new platform company

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What fields are required vs optional?
- [ ] Is the slug auto-generated from the name?
- [ ] What's the redirect on success?

---

### /admin/companies/[id]
**File:** `app/(platform)/admin/companies/[id]/page.tsx`  
**Auth:** role-gated (admin layout — `super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root) — `notFound()` for `NOT_FOUND`

**Major components rendered:**
- `TDetailSummary` — detail page shell
- `PlatformCompanyDetail` — members list, pending invitations, invite-from-detail action
- "Opollo internal" badge (for `is_opollo_internal` companies)
- "Join as admin" action (Opollo staff only, via `joinCompanyAsAdmin` server action)

**User actions on this page:**
- View company members and their roles
- View pending invitations
- Invite a new member to the company
- (Opollo staff) Join the company as admin

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What detail sections does `PlatformCompanyDetail` render?
- [ ] Can members be removed from this page?
- [ ] Can roles be edited inline?
- [ ] What happens after "Join as admin" — where does the staff member land?
- [ ] What's the 404 state?

---

### /admin/companies/[id]/cap
**File:** `app/(platform)/admin/companies/[id]/cap/page.tsx`  
**Auth:** role-gated (admin layout)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- `CapSubscriptionPanel` — CAP (Content Automation Platform) subscription management and voice profiles

**User actions on this page:**
- Create or edit CAP subscription for the company
- Manage voice profiles

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What's a CAP subscription?
- [ ] What voice profile settings are available?
- [ ] What's shown when no subscription exists?
- [ ] What does enabling CAP unlock for the company?

---

### /admin/companies/[id]/cap/campaigns
**File:** `app/(platform)/admin/companies/[id]/cap/campaigns/page.tsx`  
**Auth:** role-gated (admin layout)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- CAP campaigns list for the company

**User actions on this page:**
- Browse CAP campaigns
- Create a new campaign

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is a CAP campaign?
- [ ] What columns are shown?
- [ ] What's the empty state?

---

### /admin/companies/[id]/cap/campaigns/[campaignId]
**File:** `app/(platform)/admin/companies/[id]/cap/campaigns/[campaignId]/page.tsx`  
**Auth:** role-gated (admin layout)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- CAP campaign detail

**User actions on this page:**
- View and manage a CAP campaign

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What does a campaign contain (schedules, content, targets)?
- [ ] Can the campaign be paused or archived?

---

### /admin/companies/[id]/cap/analytics
**File:** `app/(platform)/admin/companies/[id]/cap/analytics/page.tsx`  
**Auth:** role-gated (admin layout)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- CAP analytics for the company

**User actions on this page:**
- Read CAP performance metrics

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What metrics are shown?
- [ ] What time window?

---

### /admin/companies/[id]/social-profiles
**File:** `app/(platform)/admin/companies/[id]/social-profiles/page.tsx`  
**Auth:** role-gated (admin layout)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Social profiles list for the company (BSP multi-profile feature)

**User actions on this page:**
- View social profiles for the company
- Create a new profile
- Navigate to profile connections or analytics

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What's a social profile vs a connection?
- [ ] Can profiles be renamed or deleted?
- [ ] What's the default profile?

---

### /admin/companies/[id]/social-profiles/[profileId]/connections
**File:** `app/(platform)/admin/companies/[id]/social-profiles/[profileId]/connections/page.tsx`  
**Auth:** role-gated (admin layout)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Connections for a specific social profile (admin view)

**User actions on this page:**
- View and manage connections assigned to this profile
- Reassign connections between profiles

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can connections be moved between profiles from this page?
- [ ] What's shown when the profile has no connections?

---

### /admin/companies/[id]/social-profiles/[profileId]/analytics
**File:** `app/(platform)/admin/companies/[id]/social-profiles/[profileId]/analytics/page.tsx`  
**Auth:** role-gated (admin layout)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Per-profile social analytics (BSP analytics foundation, migration 0121)

**User actions on this page:**
- Read engagement analytics for this social profile

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What metrics are shown?
- [ ] What platforms are covered?
- [ ] What time range is shown by default?

---

## 9. Admin — Images & Media

---

### /admin/images
**File:** `app/(platform)/admin/images/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** `q` (free-text search), `tag` (repeated, AND semantics), `source` (istock/upload/generated), `deleted` (`1` = archived), `page` (1-indexed)  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- `TListWide` — wide list shell with pagination
- `ImagesTable` — filterable table of images with preview thumbnails

**User actions on this page:**
- Search by caption/keyword
- Filter by tag (AND semantics)
- Filter by source (istock, upload, generated)
- Toggle archived view
- Paginate results
- Click image row to go to `/admin/images/[id]`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What columns does `ImagesTable` show?
- [ ] What's the default page size?
- [ ] Can images be uploaded from this page?
- [ ] What does "archived" mean — soft-deleted from the image library?
- [ ] How does the full-text search work (tsv index)?

---

### /admin/images/[id]
**File:** `app/(platform)/admin/images/[id]/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Image detail (preview, metadata, tags, source, caption, restore/archive actions)

**User actions on this page:**
- View full image with metadata
- Edit tags or caption
- Archive (soft-delete) the image
- Restore an archived image

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What metadata is shown (dimensions, file size, Cloudflare ID, upload date)?
- [ ] What happens on archive — is the image removed from batch generation immediately?
- [ ] Can the Cloudflare ID be changed?

---

### /admin/media
**File:** `app/(platform)/admin/media/page.tsx`  
**Auth:** role-gated (admin layout)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Admin media management page (distinct from `/admin/images` — likely for WP media or Supabase Storage assets)

**User actions on this page:**
- Browse/manage admin-level media assets

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What's the difference between `/admin/media` and `/admin/images`?
- [ ] What storage backend is used here?

---

## 10. Admin — Insights

---

### /admin/insights
**File:** `app/(platform)/admin/insights/page.tsx`  
**Auth:** role-gated (admin layout) + `is_cap_operator` RPC; non-CAP operators redirected to `/admin`  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- `PageShell` / `PageHeader`
- `PortfolioKPIs` — aggregate KPIs across all managed clients
- `AdminRoster` — table of all clients with health status (green/amber/red)
- `RecentAdminActivity` — last 10 admin activity events
- `StaleDataAlerts` — amber/red health clients
- "Compare" button → `/admin/insights/compare`

**User actions on this page:**
- Read portfolio-wide KPIs
- Review client health roster
- Identify stale-data clients
- Navigate to client detail or compare view

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What KPIs are shown in `PortfolioKPIs`?
- [ ] What determines a client's health status (red/amber/green)?
- [ ] What's in `RecentAdminActivity` — post publishes, connection changes, errors?
- [ ] What role has `is_cap_operator`?

---

### /admin/insights/clients/[id]
**File:** `app/(platform)/admin/insights/clients/[id]/page.tsx`  
**Auth:** role-gated (admin layout) + `is_cap_operator`  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Per-client insights dashboard

**User actions on this page:**
- Read client-specific performance data

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What metrics are shown per client?
- [ ] Is this the same as the company-level insights or admin-enriched?

---

### /admin/insights/clients/[id]/competitors
**File:** `app/(platform)/admin/insights/clients/[id]/competitors/page.tsx`  
**Auth:** role-gated (admin layout) + `is_cap_operator`  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Competitor management for a client

**User actions on this page:**
- Add, edit, or remove competitors for the client

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What information is tracked per competitor?
- [ ] How does competitor data feed into the gap analysis?

---

### /admin/insights/compare
**File:** `app/(platform)/admin/insights/compare/page.tsx`  
**Auth:** role-gated (admin layout) + `is_cap_operator`  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Cross-client comparison view

**User actions on this page:**
- Compare performance metrics across clients side-by-side

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] How many clients can be compared at once?
- [ ] What metrics are compared?

---

### /admin/insights/patterns
**File:** `app/(platform)/admin/insights/patterns/page.tsx`  
**Auth:** role-gated (admin layout) + `is_cap_operator`  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Pattern library admin view

**User actions on this page:**
- Browse cross-client learned patterns

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is a "pattern" (content format, timing, hashtag set, etc.)?
- [ ] Are patterns editable by admins?

---

## 11. Admin — Users & System

---

### /admin/users
**File:** `app/(platform)/admin/users/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- `TListWide` — wide list shell
- `UsersTable` — all `opollo_users` (Opollo admin accounts) with inline role editing
- `PendingInvitesTable` — pending `invites` rows
- `InviteUserButton` — opens invite modal
- "Audit log" link (super_admin only) → `/admin/users/audit`

**User actions on this page:**
- View all admin/operator users
- Change a user's role inline (server blocks self-modification, last-admin demotion, and super_admin row changes)
- View pending invitations
- Revoke a pending invite
- Invite a new admin/user via email

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What columns does `UsersTable` show?
- [ ] What roles are available (`super_admin`, `admin`, `user`)?
- [ ] Can a user be revoked (soft-deleted) from this page?
- [ ] What happens when you revoke the last admin?
- [ ] What's shown when `super_admin` visits vs `admin`?

---

### /admin/users/audit
**File:** `app/(platform)/admin/users/audit/page.tsx`  
**Auth:** role-gated (`super_admin` only)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- User/role change audit log

**User actions on this page:**
- Read history of who changed what role when

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What columns are in the audit log?
- [ ] How far back does the log go?
- [ ] Is there filtering by user or date?

---

### /admin/system/health
**File:** `app/(platform)/admin/system/health/page.tsx`  
**Auth:** role-gated (`super_admin` only)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- `PageShell` / `PageHeader`
- `ServiceStatusGrid` — grid of services with red/yellow/green status dots
- `EventTimeline` — timeline of `service_health_events` for the last 30 days (capped at 500)
- "Tomorrow's digest preview" sidebar (based on last 24h events)
- Critical/degraded alerts at page top

**User actions on this page:**
- Monitor which services are down or degraded
- Read event timeline for root cause investigation
- Preview tomorrow's health digest email

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What services are tracked?
- [ ] What's the critical severity threshold?
- [ ] Does the page auto-refresh?
- [ ] Who receives the daily digest email?

---

### /admin/system/jobs
**File:** `app/(platform)/admin/system/jobs/page.tsx`  
**Auth:** role-gated (`super_admin` or `admin`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Background job queue monitor

**User actions on this page:**
- View queued / running / failed background jobs
- (Possibly) retry or cancel jobs

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What job types are shown (QStash, Supabase cron, etc.)?
- [ ] How many historical jobs are shown?
- [ ] Can jobs be retried from this page?

---

### /admin/errors
**File:** `app/(platform)/admin/errors/page.tsx`  
**Auth:** role-gated (admin layout)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Client error log table (from `client_errors` table, migration 0140/0141)

**User actions on this page:**
- Browse client-side errors captured in production

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What data is captured per error (message, stack, URL, user, timestamp)?
- [ ] Is there filtering by severity or date?
- [ ] How long are errors retained?

---

### /admin/email-test
**File:** `app/(platform)/admin/email-test/page.tsx`  
**Auth:** role-gated (admin layout)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Email send test form (test SendGrid templates)

**User actions on this page:**
- Send a test email using a specific template

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What email templates can be tested?
- [ ] Is this accessible in production or development only?

---

### /admin/maintenance
**File:** `app/(platform)/admin/maintenance/page.tsx`  
**Auth:** role-gated (admin layout)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Maintenance tools and admin utilities

**User actions on this page:**
- Run maintenance scripts/utilities

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What maintenance operations are available?
- [ ] Are these destructive?

---

### /admin/maintenance/social-connections
**File:** `app/(platform)/admin/maintenance/social-connections/page.tsx`  
**Auth:** role-gated (admin layout)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Social connections maintenance tools

**User actions on this page:**
- Manually trigger connection sync, fix stuck pending_identity rows, etc.

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What specific operations are available?
- [ ] Are operations scoped per-company or global?

---

## 12. Admin — Design System & Settings

---

### /admin/settings
**File:** `app/(platform)/admin/settings/page.tsx`  
**Auth:** role-gated (admin layout)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Admin settings overview

**User actions on this page:**
- Navigate to sub-settings sections

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What settings are accessible?
- [ ] Is there a design system settings sub-section?

---

### /admin/settings/design-system
**File:** `app/(platform)/admin/settings/design-system/page.tsx`  
**Auth:** role-gated (admin layout)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Global design system settings

**User actions on this page:**
- Configure global DS defaults or token overrides

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What global DS settings exist?

---

### /admin/theming
**File:** `app/(platform)/admin/theming/page.tsx`  
**Auth:** role-gated (admin layout)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Theming configuration (soft-light theme token overrides)

**User actions on this page:**
- Adjust UI theme tokens

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does changing theming affect the whole platform or just preview?

---

### /admin/_internal/table-examples
**File:** `app/(platform)/admin/_internal/table-examples/page.tsx`  
**Auth:** role-gated (admin layout — internal dev page)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Table component examples and primitives

**User actions on this page:**
- Dev reference for table variants

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Should this be accessible in production?
- [ ] Is there a route guard beyond admin role?

---

## 13. Admin — Social Profiles (standalone maintenance view)

---

_Social profile admin pages are grouped under §8 Admin — Companies & CAP above (`/admin/companies/[id]/social-profiles/*`). No standalone `/admin/social-profiles` routes exist._

---

## 14. Optimiser

---

### /optimiser
**File:** `app/(platform)/optimiser/page.tsx`  
**Auth:** authenticated (platform session — optimiser layout likely adds its own gate)  
**Search params:** `client` — selected client ID (defaults to first onboarded client)  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- `PageHeader` with `ClientSwitcher` (when >1 onboarded client)
- `ConnectorBannerView` — status banners for data connectors (GSC, GA4, etc.)
- `PageBrowser` — table of landing pages with alignment score, conversion rate, bounce rate, scroll depth, session count
- `EmptyState` — when no onboarded clients exist

**User actions on this page:**
- Switch between clients (if multiple)
- Browse landing pages with performance metrics
- Click a landing page row to navigate to detail
- Navigate to onboarding wizard

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What columns are in `PageBrowser`?
- [ ] What does the alignment score represent?
- [ ] What's the 30-day window for metrics?
- [ ] What connector banners can appear (GSC not connected, stale data, etc.)?
- [ ] What's the empty state for an onboarded client with no pages?

---

### /optimiser/pages/[id]
**File:** `app/(platform)/optimiser/pages/[id]/page.tsx`  
**Auth:** authenticated (optimiser layout gate)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Landing page detail with metrics, open proposals, active tests, staged-rollout state

**User actions on this page:**
- Read page performance
- Navigate to open proposals for this page
- View A/B test status
- View staged-rollout progress

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What sections does the detail page have?
- [ ] What metrics are shown (traffic, conversion, alignment, scroll)?

---

### /optimiser/proposals
**File:** `app/(platform)/optimiser/proposals/page.tsx`  
**Auth:** authenticated (optimiser layout gate)  
**Search params:** `client` — client ID filter  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- `TListStandard` — list shell
- Proposals table: headline, problem_summary, risk_level pill (low/medium/high), priority_score, confidence_score, effort_bucket, expected_impact, expires_at, "Review" link
- Client selector (if >1 onboarded client)
- "Page browser" link

**User actions on this page:**
- Switch client
- Click "Review" to open proposal detail

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are only `pending` state proposals shown?
- [ ] What's the default sort order?
- [ ] What's the empty state (no pending proposals)?
- [ ] What does `expires_at` mean for a proposal?

---

### /optimiser/proposals/[id]
**File:** `app/(platform)/optimiser/proposals/[id]/page.tsx`  
**Auth:** authenticated (optimiser layout gate)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root) — `notFound()` if proposal not found

**Major components rendered:**
- `TDetailSummary` — detail shell
- `ProposalReview` — full proposal with evidence, change_set, before_snapshot, current performance
- `PastCausalDeltasPanel` — what happened last time this playbook was applied (up to 5 deltas)
- `PatternPriorsPanel` — cross-client pattern priors for the playbook
- `ProposalRolloutLink` — link to staged-rollout state when applied
- `ProposalAppliedMoment` — inline alert when proposal is already applied
- `CreateVariantButton` — create A/B test variant (visible when approved/applied + no active test)

**User actions on this page:**
- Read full proposal evidence and change set
- Approve or reject the proposal (via `ProposalReview` form)
- Create an A/B test variant (when approved/applied)
- Navigate back to proposals list

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What does approving a proposal do (creates a rollout, triggers a deploy)?
- [ ] What evidence is shown in `ProposalReview`?
- [ ] What's the confidence score breakdown (sample, freshness, stability, signal)?
- [ ] When does `CreateVariantButton` appear?
- [ ] What's shown in `PastCausalDeltasPanel` when no prior history exists?

---

### /optimiser/onboarding
**File:** `app/(platform)/optimiser/onboarding/page.tsx`  
**Auth:** authenticated (optimiser layout gate)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Client onboarding list (start new or continue in-progress onboarding)

**User actions on this page:**
- Start a new client onboarding
- Continue an in-progress onboarding

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What does the onboarding collect?
- [ ] Can onboarding be skipped?

---

### /optimiser/onboarding/[id]
**File:** `app/(platform)/optimiser/onboarding/[id]/page.tsx`  
**Auth:** authenticated (optimiser layout gate)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Multi-step client onboarding wizard

**User actions on this page:**
- Complete onboarding steps (domain, GSC connection, GA4 connection, landing page import)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What steps are in the wizard?
- [ ] Can steps be re-done after onboarding completes?

---

### /optimiser/clients/[id]/settings
**File:** `app/(platform)/optimiser/clients/[id]/settings/page.tsx`  
**Auth:** authenticated (optimiser layout gate)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Client settings (hosting mode, cross-client learning consent, connector configuration)

**User actions on this page:**
- Edit client settings
- Configure hosting mode (opollo_subdomain/opollo_cname/client_slice)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What settings are available?
- [ ] Does changing hosting mode affect existing variants?

---

### /optimiser/imports/[brief_id]
**File:** `app/(platform)/optimiser/imports/[brief_id]/page.tsx`  
**Auth:** authenticated (optimiser layout gate)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Import review for a landing page brief

**User actions on this page:**
- Review and confirm a landing page import

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What does an optimiser import contain?
- [ ] What's the trigger for reaching this page?

---

### /optimiser/change-log
**File:** `app/(platform)/optimiser/change-log/page.tsx`  
**Auth:** authenticated (optimiser layout gate)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Optimiser change log (applied proposals, A/B test outcomes, rollouts)

**User actions on this page:**
- Read history of applied changes

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What events are logged?
- [ ] Is there filtering by client or date?

---

### /optimiser/diagnostics
**File:** `app/(platform)/optimiser/diagnostics/page.tsx`  
**Auth:** authenticated (optimiser layout gate)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Optimiser diagnostics dashboard (connector health, data freshness, pipeline state)

**User actions on this page:**
- Diagnose connector issues
- Check data pipeline state

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What connectors are checked (GSC, GA4, others)?
- [ ] What's shown when all connectors are healthy?

---

## 15. Public & Token-gated

---

### /viewer/[token]
**File:** `app/viewer/[token]/page.tsx`  
**Auth:** none (token IS the auth — SHA-256 hash matched against `social_viewer_links`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Read-only content calendar: posts grouped by date (approved/scheduled/published states only)
- Per-entry: platform label, scheduled time, post text, link URL
- `InvalidLink` — shown for bad/expired/revoked tokens

**User actions on this page:**
- Read the content calendar (no interactive surface)
- Click an external link URL if present on a post entry

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What window does the calendar show (currently 30 days back, 60 days forward)?
- [ ] What post states are visible (approved, scheduled, published only)?
- [ ] What's the invalid token state?
- [ ] Is there any branding/company header?
- [ ] Does the timezone follow the company's configured timezone?

---

### /review/[token]
**File:** `app/(public)/review/[token]/page.tsx`  
**Auth:** none (JWT token signed with `NEXTAUTH_SECRET` / `AUTH_SECRET`, claims: `sub=draftId, purpose='review'`)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Post content display (text, attached media thumbnails)
- `ReviewDecisionForm` — approve / reject buttons (disabled if already decided)
- "Already decided" banner when post state is not `pending_approval`
- `InvalidLink` — shown for bad/expired tokens

**User actions on this page:**
- Read the post content and media
- Click Approve or Reject (once only while `pending_approval`)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens on Approve — does the post auto-schedule?
- [ ] What happens on Reject?
- [ ] What's shown after the decision is submitted?
- [ ] How long is the JWT valid (currently 14 days)?
- [ ] Is there a way to leave a comment with a rejection?

---

### /approve/[token]  _(root-level)_
**File:** `app/approve/[token]/page.tsx`  
**Auth:** none (token-based)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- (Requires further investigation — root-level approve flow separate from `/auth/approve`)

**User actions on this page:**
- Approve or decline a token-gated action

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What resource does this token gate (WP page approval, social post, other)?
- [ ] How does this differ from `/review/[token]`?
- [ ] What's the success state?

---

## 16. Dev/Internal

---

### /(dev)/design-system
**File:** `app/(dev)/design-system/page.tsx`  
**Auth:** none (dev route group)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Design system component kitchen sink / storybook-style preview

**User actions on this page:**
- Browse all UI components, colour tokens, and typography

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is this blocked in production (middleware or route group config)?
- [ ] Should it require authentication?

---

### /social/poster
**File:** `app/(platform)/social/poster/page.tsx`  
**Auth:** authenticated (platform session)  
**Search params:** none  
**States:** loading.tsx ✓ (colocated at `app/(platform)/social/poster/loading.tsx`) · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Social poster interface (likely a standalone quick-post surface)

**User actions on this page:**
- Compose and post quickly without the full calendar flow

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is this the same as the calendar composer or a distinct flow?
- [ ] What platforms can be posted to from here?
- [ ] Is this page still in active use or superseded by the calendar composer?

---

### /admin/page (root redirect)
**File:** `app/(platform)/admin/page.tsx`  
**Auth:** role-gated (admin layout)  
**Search params:** none  
**States:** n/a — pure redirect to `/admin/sites`

**Major components rendered:**
- None (immediate `redirect("/admin/sites")`)

**User actions on this page:**
- None

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Should `/admin` always redirect to `/admin/sites` or should it eventually be a dashboard?

---

### / (root)
**File:** `app/page.tsx`  
**Auth:** none (likely redirects based on session)  
**Search params:** none  
**States:** loading.tsx ✗ · error.tsx ✓ (root) · not-found.tsx ✓ (root)

**Major components rendered:**
- Root page (likely redirect to `/login` or `/admin/sites`)

**User actions on this page:**
- None (automatic redirect)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Where does an unauthenticated user land from `/`?
- [ ] Where does a signed-in admin land from `/`?
- [ ] Where does a signed-in platform user land from `/`?

---

*End of inventory. Sections left to fill by Steven: all `EXPECTED BEHAVIOUR` checkboxes above.*
