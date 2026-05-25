# Routes and Pages Inventory

> Generated: 2026-05-25. 103 pages catalogued.
> Covers every `page.tsx` file discovered under `app/`. File paths relative to repo root.
> EXPECTED BEHAVIOUR checkboxes are intentionally empty — Steven to fill.

---

## Authentication / Public

### /

**File:** `app/page.tsx`
**Auth:** Redirects to appropriate landing based on session state
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Root redirect only

**User actions on this page:**
- Automatic redirect (no user interaction)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Where does an unauthenticated user land?
- [ ] Where does an authenticated admin land vs an authenticated company member?

---

### /login

**File:** `app/login/page.tsx`
**Auth:** Public (unauthenticated)
**Search params:** `?next=` (redirect destination after successful login)
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Email + password sign-in form

**User actions on this page:**
- Submit email + password credentials
- Navigate to /auth/forgot-password

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens when `?next=` points to an unauthorised route for the user's role?
- [ ] What happens on repeated failed login attempts (rate limit behaviour)?
- [ ] Is the 2FA challenge triggered from this page, and does it redirect or inline?

---

### /login/check-email

**File:** `app/login/check-email/page.tsx`
**Auth:** Public
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Informational panel

**User actions on this page:**
- None (static)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is this shown after magic-link email dispatch, forgot-password, or both?

---

### /auth/callback

**File:** `app/auth/callback/page.tsx`
**Auth:** Public (OAuth/magic-link token in query string)
**Search params:** OAuth callback parameters (code, state, etc.)
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Redirect/processing page

**User actions on this page:**
- None (automated redirect from OAuth provider)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens when the OAuth state parameter is invalid or missing?
- [ ] What happens when the callback token has expired?

---

### /auth/forgot-password

**File:** `app/auth/forgot-password/page.tsx`
**Auth:** Public
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Email input form

**User actions on this page:**
- Submit email to receive reset link

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is there rate limiting on the forgot-password form?
- [ ] What response does the user see for an email that doesn't exist?

---

### /auth/reset-password

**File:** `app/auth/reset-password/page.tsx`
**Auth:** Token-authenticated (reset token in URL)
**Search params:** Reset token parameters
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- New password form

**User actions on this page:**
- Set new password

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens when the reset token has already been used?
- [ ] What happens when the reset token has expired?
- [ ] Are password complexity requirements surfaced to the user?

---

### /auth/accept-invite

**File:** `app/auth/accept-invite/page.tsx`
**Auth:** Token-authenticated (invite token)
**Search params:** Invite token parameters
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Invite acceptance form (set password / confirm identity)

**User actions on this page:**
- Accept invitation and set credentials

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens when an invitation has expired before being accepted?
- [ ] What happens when an invitation has already been accepted?

---

### /auth/approve

**File:** `app/auth/approve/page.tsx`
**Auth:** Public or session-based (unclear without further inspection)
**Search params:** Approval parameters
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Approval action page

**User actions on this page:**
- Approval decision

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is this the internal-session approval flow as distinct from /approve/[token]?

---

### /auth/expired

**File:** `app/auth/expired/page.tsx`
**Auth:** Public
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Expired session/link panel

**User actions on this page:**
- Navigate back to login

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is this page shown for expired magic links, expired sessions, or both?

---

### /auth-error

**File:** `app/auth-error/page.tsx`
**Auth:** Public
**Search params:** Error code parameters
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Error message panel

**User actions on this page:**
- Navigate back to login

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What error codes are handled, and what is the fallback for unknown codes?

---

### /invite/[token]

**File:** `app/invite/[token]/page.tsx`
**Auth:** Token-authenticated (no platform session required)
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Invite claim page

**User actions on this page:**
- Accept company invitation

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is shown when the token is invalid vs expired vs already accepted?

---

### /approve/[token]

**File:** `app/approve/[token]/page.tsx`
**Auth:** Token-authenticated (no platform session required) — token is SHA-256 hashed to look up `approval_recipients` row
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- `ApprovalDecisionForm` — renders post snapshot read-only + decision buttons (Approve / Reject)

**User actions on this page:**
- Approve the post
- Reject the post with a reason (30–500 chars)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is shown when someone tries to approve a post that another recipient has already decided?
- [ ] What is shown when the token has been revoked (draft deleted / post re-opened)?
- [ ] Does the page re-render in real time if another user decides while this page is open?
- [ ] Can an approver change their decision after submitting?

---

### /viewer/[token]

**File:** `app/viewer/[token]/page.tsx`
**Auth:** Token-authenticated (no platform session required) — token resolves to `social_viewer_links` row
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Read-only schedule list grouped by date (60 days forward, 30 days back from now)

**User actions on this page:**
- None (read-only)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are posts in `draft` or `pending_approval` states hidden from the viewer?
- [ ] What post states are visible (approved, scheduled, published only)?
- [ ] What happens when the viewer link is deleted by an admin?
- [ ] Is there a "last updated" timestamp shown to the recipient?

---

### /review/[token]

**File:** `app/(public)/review/[token]/page.tsx`
**Auth:** Token-authenticated (public layout group)
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Review surface (distinct from /approve/[token])

**User actions on this page:**
- Review content

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] How does this differ from /approve/[token] in terms of affordances?

---

### /connect/pick-channel

**File:** `app/connect/pick-channel/page.tsx`
**Auth:** Platform session required
**Search params:** OAuth state / connection_id parameters
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Channel/page selector modal or page

**User actions on this page:**
- Select a Facebook Page or LinkedIn Org Page from the discovered list
- Choose to connect as personal profile (LinkedIn)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens when no channels are found for the connected account?
- [ ] Can the user return to this page later if they don't complete channel selection?

---

## Company Social

All pages in this group require an authenticated platform session. Unauthenticated requests redirect to `/login?next=<current-path>`. Missing `company` context renders a "Not provisioned" envelope.

---

### /company/social/calendar

**File:** `app/(platform)/company/social/calendar/page.tsx`
**Auth:** `getCurrentPlatformSession()` → redirect `/login` if none; "Not provisioned" if no `session.company`; any company member (viewer+)
**Search params:** `?compose=new` (open composer for new draft); `?compose=[uuid]` (open composer in edit mode for existing draft)
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- `CalendarShell` — 7-column month grid, DnD reschedule, day-detail panel, bulk CSV upload, post analytics modal, timeline toggle, profile filter
- `ComposerMountV2` (layout-level) — handles `?compose=` URL params

**User actions on this page:**
- Navigate months
- Click a day to see day-detail panel
- Click a post chip to open post detail
- Drag-and-drop to reschedule a post
- Open composer via FAB / "New post" button
- Open composer in edit mode via `?compose=[uuid]`
- Filter by social profile
- Toggle timeline view
- Upload posts via bulk CSV

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What states are shown as chips on the calendar grid (all states, or only scheduled/published/failed)?
- [ ] What does a user with no connections see (empty state)?
- [ ] What does a user with only `pending_identity` connections see?
- [ ] Does the composer in edit mode gate on `edit_post` permission and return an error for viewers?
- [ ] Are `recurring` parent drafts shown on the calendar?
- [ ] What happens to a `paused` recurring series — are the future instances hidden?

---

### /company/social/posts

**File:** `app/(platform)/company/social/posts/page.tsx`
**Auth:** `getCurrentPlatformSession()` → redirect `/login`; viewer+ (`view_calendar`); editor+ also gets "New post" button
**Search params:** `?q=` (text search); `?page=` (pagination, PAGE_SIZE=25); `?state=draft|pending_client_approval|approved|rejected|changes_requested|scheduled|publishing|published|failed`; `?sort=state_changed_at|created_at`; `?dir=asc|desc`
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- `SocialPostsListClient` — filterable list with state pills
- `TListStandard` — layout template

**User actions on this page:**
- Search posts by text
- Filter by state
- Sort by date columns
- Paginate through results
- Click row to go to post detail
- Create new post (editor+)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What does a viewer (non-editor) see when the list is empty?
- [ ] Are `recurring` parent drafts listed here alongside one-off drafts?
- [ ] What state labels are shown in the UI pills (e.g. "Pending approval" vs raw `pending_approval`)?
- [ ] Does pagination reset when filters change?
- [ ] Can a viewer see posts that belong to other company members?

---

### /company/social/posts/[id]

**File:** `app/(platform)/company/social/posts/[id]/page.tsx`
**Auth:** `getCurrentPlatformSession()` → redirect `/login`; `notFound()` if post not in user's company; `edit_post` drives Edit/Delete affordances
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- `PostDetailTabbedClient` — tabbed detail view
- `PostApprovalSection` — visible when state is in `POST_DECISION_STATES` (approved/rejected/changes_requested)
- `PostDecisionsAudit` — approval history
- `PostPublishHistorySection` — visible when state is in `PUBLISH_VISIBLE_STATES` (publishing/published/failed)
- `PostScheduleSection`
- `PostVariantsSection`

**User actions on this page:**
- View post content and metadata
- Edit post (if `edit_post` permission and post in `draft` state)
- Delete post (if `edit_post` permission)
- View approval history
- View publish attempts (for publishing/published/failed states)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens when an editor tries to edit a post that is in `scheduled` or `published` state?
- [ ] Is the full approval decision audit visible to all roles, or only admins?
- [ ] What does the `PostVariantsSection` show when no per-platform variants exist?
- [ ] For a `failed` post, is there a retry affordance on this page?
- [ ] For a `recurring` parent draft, what sections are shown?

---

### /company/social/connections

**File:** `app/(platform)/company/social/connections/page.tsx`
**Auth:** `getCurrentPlatformSession()` → redirect `/login`; viewer+ (`view_calendar`) to see list; admin (`manage_connections`) for Reconnect button
**Search params:** `?connect=success|error|noop|sync-failed`; `?reason=not-enough-permissions|not-enough-pages|auth-failed|user-cancelled`; `?count=`; `?connection_id=` (auto-opens channel-picker modal); `?attempted_platform=` (highlights existing row); `?reconnect=` (scrolls to + highlights matching row)
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- `SocialConnectionsList` — per-row status pills and Reconnect buttons
- `Alert` — contextual toast banners driven by query params
- `TListStandard` — layout template

**User actions on this page:**
- View all connected social accounts and their status
- Click Reconnect on an `auth_required` connection (admin only)
- Connect a new account (admin only)
- Disconnect a connection (admin only)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What does a viewer (non-admin) see on a row with `auth_required` status — is the Reconnect button hidden or disabled?
- [ ] What does the `pending_identity` state look like to a viewer vs an admin?
- [ ] Is the `disconnected` status shown in the list or filtered out?
- [ ] What happens when `?connect=noop` and `?attempted_platform=facebook` — which row gets highlighted?
- [ ] How long does the contextual banner stay visible before dismissing?

---

### /company/social/connections/connect/[platform]

**File:** `app/(platform)/company/social/connections/connect/[platform]/page.tsx`
**Auth:** Platform session required (page redirects to `/company/social/connections` immediately — stub for deep-link routing)
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Redirect only (no render)

**User actions on this page:**
- None (immediate redirect)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is this page ever linked to directly, or is it only reachable by URL typing?

---

### /company/social/media

**File:** `app/(platform)/company/social/media/page.tsx`
**Auth:** `getCurrentPlatformSession()` → redirect `/login`; viewer+ (`view_calendar`) to view; editor+ (`edit_post`) to add assets
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- `MediaLibraryClient` — grid of uploaded assets
- `TGrid` — layout template

**User actions on this page:**
- Browse uploaded media assets
- Upload new media (editor+)
- Select asset to insert into composer (when opened from composer)
- Delete an asset (editor+)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What file types are accepted for upload?
- [ ] Is there a storage quota per company?
- [ ] What happens when a media asset is used in a scheduled/published post and then deleted?
- [ ] Are assets shared across the company or per-user?

---

### /company/social/analytics

**File:** `app/(platform)/company/social/analytics/page.tsx`
**Auth:** `getCurrentPlatformSession()` → redirect `/login`; `view_calendar` permission required; `view_insights` permission for data
**Search params:** None
**States:** loading.tsx ✓ (`app/(platform)/company/social/analytics/loading.tsx`) · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- `SocialAnalyticsClient` — dynamic import, SSR=false; loading skeleton shown inline
- `TDashboardKpi` — layout template

**User actions on this page:**
- View social analytics KPIs
- (Future) filter by date range

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is shown when there is no analytics data yet (new company)?
- [ ] What happens for a user with `view_calendar` but not `view_insights` — error or empty state?
- [ ] What analytics dimensions are surfaced (impressions, reach, engagement, etc.)?

---

### /company/social/insights

**File:** `app/(platform)/company/social/insights/page.tsx`
**Auth:** `getCurrentPlatformSession()` → redirect `/login`; company member required
**Search params:** `?period=7d|30d|90d` (default: 30d)
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- `InsightsDashboardClient` — insights recommendations and trends
- `CompetitorGapAnalysis` — competitor comparison panel
- `PeriodSelector` — period filter UI
- `StatusPill` — freshness indicator

**User actions on this page:**
- Select analysis period (7d / 30d / 90d)
- View recommendations
- View competitor gap analysis

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is shown before any competitor data has been scraped?
- [ ] What permission level is required to see the CompetitorGapAnalysis panel?
- [ ] What does "dismiss recommendation" do — is it permanent?

---

### /company/social/sharing

**File:** `app/(platform)/company/social/sharing/page.tsx`
**Auth:** `getCurrentPlatformSession()` → redirect `/login`; admin only (`manage_invitations`); non-admin sees "Admins only" panel
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- `ViewerLinksManager` — list of active viewer share links
- `TSettingsFlat` — layout template

**User actions on this page:**
- Create a new viewer share link
- Copy link URL
- Delete an existing viewer link

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is there a limit on how many viewer links a company can have?
- [ ] When a viewer link is deleted, does anyone with that link immediately see an error, or is there a grace period?
- [ ] Can viewer links be given friendly names?

---

### /company/social/timeline

**File:** `app/(platform)/company/social/timeline/page.tsx`
**Auth:** `getCurrentPlatformSession()` → redirect `/login`; viewer+ (`view_calendar`)
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- `TimelineFeed` — chronological feed of all posts, newest first
- `TDashboardFeed` — layout template
- `PillTabs` — view toggle
- "New post" CTA (editor+ only via `composerEnabled`)

**User actions on this page:**
- Scroll chronological post feed
- Create new post (editor+)
- Navigate to post detail (click row)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does the timeline include all states or only published/scheduled?
- [ ] Is there pagination, and if so what page size?

---

### /company

**File:** `app/(platform)/company/page.tsx`
**Auth:** Platform session required
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Company landing / dashboard

**User actions on this page:**
- Navigate to sub-sections

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the default landing experience for a newly provisioned company?

---

### /company/social

**File:** `app/(platform)/company/social/page.tsx`
**Auth:** Platform session required
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Social module landing / redirect

**User actions on this page:**
- Redirect or navigation

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does this redirect to /calendar, /posts, or show a dashboard overview?

---

### /company/settings/brand

**File:** `app/(platform)/company/settings/brand/page.tsx`
**Auth:** Platform session required; admin gate expected
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Brand profile settings form

**User actions on this page:**
- Update brand name, colours, logo, voice profile

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What permission level is required to edit brand settings?
- [ ] Are brand settings versioned or overwritten on save?

---

### /company/settings/insights

**File:** `app/(platform)/company/settings/insights/page.tsx`
**Auth:** Platform session required; admin gate expected
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Insights configuration settings

**User actions on this page:**
- Configure insights preferences

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What settings are exposed here (competitor URLs, industry, etc.)?

---

### /company/users

**File:** `app/(platform)/company/users/page.tsx`
**Auth:** Platform session required; admin-scoped operations
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- User roster with roles
- Invite member form (admin only)

**User actions on this page:**
- View company members and their roles
- Invite new member (admin)
- Change member role (admin)
- Revoke member access (admin)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can a non-admin member see the user list?
- [ ] What happens when an admin tries to revoke themselves?

---

### /company/image/generate

**File:** `app/(platform)/company/image/generate/page.tsx`
**Auth:** Platform session required
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- AI image generation form

**User actions on this page:**
- Generate AI images for use in posts

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What permission level is required to generate images (any member, or editor+)?
- [ ] Is there a per-company generation quota?

---

### /company/internal/autosave-lab

**File:** `app/(platform)/company/internal/autosave-lab/page.tsx`
**Auth:** Platform session required (internal development page)
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Autosave development/testing surface

**User actions on this page:**
- Test autosave behaviour

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is this page gated to internal staff only, or accessible to any company member?

---

## Admin

All pages in this group call `checkAdminAccess()` which requires `super_admin` or `admin` role. Some sub-pages require `super_admin` only (noted below). Non-admin users are redirected.

---

### /admin

**File:** `app/(platform)/admin/page.tsx`
**Auth:** `checkAdminAccess()` — super_admin + admin
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Admin dashboard / navigation hub

**User actions on this page:**
- Navigate to admin sub-sections

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does the admin landing page show a summary of system health or just navigation links?

---

### /admin/sites

**File:** `app/(platform)/admin/sites/page.tsx`
**Auth:** `checkAdminAccess()` — super_admin + admin
**Search params:** Pagination / filter params
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Sites list table

**User actions on this page:**
- Search and filter sites
- Navigate to individual site detail
- Create new site

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can a regular `admin` role see all sites across all companies, or only their company's sites?

---

### /admin/sites/new

**File:** `app/(platform)/admin/sites/new/page.tsx`
**Auth:** `checkAdminAccess()` — super_admin + admin
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- New site creation form

**User actions on this page:**
- Create a new site record

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What fields are required to create a new site?

---

### /admin/sites/[id]

**File:** `app/(platform)/admin/sites/[id]/page.tsx`
**Auth:** `checkAdminAccess()` — super_admin + admin
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Site detail overview

**User actions on this page:**
- View site metadata, status, connections

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens when the site ID does not exist?

---

### /admin/sites/[id]/edit

**File:** `app/(platform)/admin/sites/[id]/edit/page.tsx`
**Auth:** `checkAdminAccess()` — super_admin + admin
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Site edit form (name, WP URL, credentials)

**User actions on this page:**
- Edit site metadata and WordPress connection details

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are WP credentials encrypted on save? (They should be via `lib/encryption.ts`)

---

### /admin/sites/[id]/settings

**File:** `app/(platform)/admin/sites/[id]/settings/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Site settings panel

**User actions on this page:**
- Configure site-level settings (budget, generation preferences, etc.)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Which settings are editable at site level vs company level?

---

### /admin/sites/[id]/content

**File:** `app/(platform)/admin/sites/[id]/content/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Site content overview (pages, posts)

**User actions on this page:**
- View generated content for the site

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does this page show published WP content or only locally tracked pages?

---

### /admin/sites/[id]/posts

**File:** `app/(platform)/admin/sites/[id]/posts/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** Pagination params
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Site blog posts list

**User actions on this page:**
- View, filter, navigate to individual posts

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are these blog posts (WordPress posts) distinct from social posts?

---

### /admin/sites/[id]/posts/new

**File:** `app/(platform)/admin/sites/[id]/posts/new/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- New post creation form

**User actions on this page:**
- Create a new blog post for the site

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is this manually written or AI-assisted?

---

### /admin/sites/[id]/posts/[post_id]

**File:** `app/(platform)/admin/sites/[id]/posts/[post_id]/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Blog post detail / editor

**User actions on this page:**
- View and edit post content
- Publish / unpublish to WordPress

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens when the post's WP site is unreachable during publish?

---

### /admin/sites/[id]/pages

**File:** `app/(platform)/admin/sites/[id]/pages/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** Pagination params
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Site pages list

**User actions on this page:**
- View generated landing pages for the site

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are these WordPress pages or locally generated page objects?

---

### /admin/sites/[id]/pages/[pageId]

**File:** `app/(platform)/admin/sites/[id]/pages/[pageId]/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Page detail and content editor

**User actions on this page:**
- View page content
- Regenerate page
- Push to WordPress

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is shown when a regeneration is in flight?

---

### /admin/sites/[id]/appearance

**File:** `app/(platform)/admin/sites/[id]/appearance/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Site appearance / design system settings

**User actions on this page:**
- Configure palette, typography
- Sync palette to WordPress
- Rollback palette

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is the palette sync to WP live (real-time) or queued?

---

### /admin/sites/[id]/setup

**File:** `app/(platform)/admin/sites/[id]/setup/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Site onboarding setup wizard

**User actions on this page:**
- Progress through design + tone extraction steps

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What steps make up the setup wizard?

---

### /admin/sites/[id]/setup/extract

**File:** `app/(platform)/admin/sites/[id]/setup/extract/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Design extraction step

**User actions on this page:**
- Trigger design extraction from client's website

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens when the client's website is unreachable during extraction?

---

### /admin/sites/[id]/onboarding

**File:** `app/(platform)/admin/sites/[id]/onboarding/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Onboarding checklist / status

**User actions on this page:**
- View onboarding progress
- Complete onboarding steps

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is onboarding gated — can generation not proceed until onboarding is complete?

---

### /admin/sites/[id]/blueprints/review

**File:** `app/(platform)/admin/sites/[id]/blueprints/review/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Blueprint review surface

**User actions on this page:**
- Approve or revert a site blueprint

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What constitutes a "blueprint" in this context (full site structure snapshot)?

---

### /admin/sites/[id]/briefs/[brief_id]/review

**File:** `app/(platform)/admin/sites/[id]/briefs/[brief_id]/review/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Brief page review surface

**User actions on this page:**
- Approve or request revisions on generated pages

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can individual pages within a brief be approved independently?

---

### /admin/sites/[id]/briefs/[brief_id]/run

**File:** `app/(platform)/admin/sites/[id]/briefs/[brief_id]/run/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Brief run progress surface (streaming generation)

**User actions on this page:**
- Watch generation progress
- Cancel generation

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens if the user navigates away during generation?

---

### /admin/sites/[id]/design-system

**File:** `app/(platform)/admin/sites/[id]/design-system/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Design system overview for the site

**User actions on this page:**
- Navigate to components, templates, preview

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is there one design system per site, or can multiple exist?

---

### /admin/sites/[id]/design-system/components

**File:** `app/(platform)/admin/sites/[id]/design-system/components/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Component library for the site's design system

**User actions on this page:**
- View, create, edit design system components

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can components be shared across sites?

---

### /admin/sites/[id]/design-system/templates

**File:** `app/(platform)/admin/sites/[id]/design-system/templates/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Page template library

**User actions on this page:**
- View, create, edit page templates

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are templates versioned?

---

### /admin/sites/[id]/design-system/preview

**File:** `app/(platform)/admin/sites/[id]/design-system/preview/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Live preview of design system applied

**User actions on this page:**
- Preview how the design system renders

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is the preview rendered in an iframe against the real WP site or a local renderer?

---

### /admin/companies

**File:** `app/(platform)/admin/companies/page.tsx`
**Auth:** `checkAdminAccess()` — super_admin + admin
**Search params:** Pagination / filter params
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Companies list table

**User actions on this page:**
- Search companies
- Navigate to company detail
- Create new company

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can a regular admin see all companies or only their own?

---

### /admin/companies/new

**File:** `app/(platform)/admin/companies/new/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- New company creation form

**User actions on this page:**
- Create a new platform company

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does creating a company auto-provision any resources (social profile, etc.)?

---

### /admin/companies/[id]

**File:** `app/(platform)/admin/companies/[id]/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- `PlatformCompanyDetail` — company overview, members, pending invitations
- `TDetailSummary` — layout template

**User actions on this page:**
- View company details and members
- Navigate to sub-pages (CAP, social profiles)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens when the company ID does not exist?

---

### /admin/companies/[id]/cap

**File:** `app/(platform)/admin/companies/[id]/cap/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- CAP (Content Amplification Platform) overview for the company

**User actions on this page:**
- View CAP subscription status
- Navigate to campaigns

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is shown when a company has no CAP subscription?

---

### /admin/companies/[id]/cap/campaigns

**File:** `app/(platform)/admin/companies/[id]/cap/campaigns/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- CAP campaigns list for the company

**User actions on this page:**
- View campaigns by month
- Navigate to campaign detail

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are campaigns shown for all statuses or filtered to active ones by default?

---

### /admin/companies/[id]/cap/campaigns/[campaignId]

**File:** `app/(platform)/admin/companies/[id]/cap/campaigns/[campaignId]/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- CAP campaign detail with 4 post slots (weekly arc phases)

**User actions on this page:**
- Review generated posts
- Approve or reject individual post slots
- Push approved posts to composer

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] When a post slot is pushed to composer, what state does it start in?
- [ ] Can a post slot be regenerated after rejection?

---

### /admin/companies/[id]/cap/analytics

**File:** `app/(platform)/admin/companies/[id]/cap/analytics/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- CAP analytics dashboard

**User actions on this page:**
- View CAP performance metrics

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What metrics are shown (post reach, engagement, cost per post)?

---

### /admin/companies/[id]/social-profiles

**File:** `app/(platform)/admin/companies/[id]/social-profiles/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Social profiles list for the company

**User actions on this page:**
- View social profiles
- Create new profile
- Navigate to profile detail

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can a company have multiple social profiles (e.g. one per brand)?

---

### /admin/companies/[id]/social-profiles/[profileId]/analytics

**File:** `app/(platform)/admin/companies/[id]/social-profiles/[profileId]/analytics/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Social profile analytics dashboard

**User actions on this page:**
- View per-profile analytics

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What platforms are covered in analytics (LinkedIn, Facebook, Instagram, etc.)?

---

### /admin/companies/[id]/social-profiles/[profileId]/connections

**File:** `app/(platform)/admin/companies/[id]/social-profiles/[profileId]/connections/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Connections attributed to this profile

**User actions on this page:**
- View connections
- Reattribute connections between profiles

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can a connection be attributed to more than one profile?

---

### /admin/users

**File:** `app/(platform)/admin/users/page.tsx`
**Auth:** `checkAdminAccess()` — super_admin + admin
**Search params:** Pagination / search params
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Platform users list

**User actions on this page:**
- Search users
- Invite new user (super_admin only)
- Change user role (super_admin only)
- Revoke access

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can a regular admin invite users, or only super_admins?

---

### /admin/users/audit

**File:** `app/(platform)/admin/users/audit/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** Date filter params
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- User action audit log

**User actions on this page:**
- View audit trail of user activity

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What events are captured in the user audit log?

---

### /admin/batches

**File:** `app/(platform)/admin/batches/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** Filter params
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Batch generation jobs list

**User actions on this page:**
- View all batch runs across sites
- Navigate to site-specific batches

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are all batch statuses shown, or only active ones by default?

---

### /admin/batches/[siteId]

**File:** `app/(platform)/admin/batches/[siteId]/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Batches for a specific site

**User actions on this page:**
- View batch history for the site
- Create new batch

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What batch size limits apply per site?

---

### /admin/batches/[siteId]/[batchId]

**File:** `app/(platform)/admin/batches/[siteId]/[batchId]/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Batch detail with per-page status rows

**User actions on this page:**
- View generation progress
- Cancel batch

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can a partial batch be re-run for only the failed pages?

---

### /admin/images

**File:** `app/(platform)/admin/images/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** Search/filter params
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Central image library list

**User actions on this page:**
- Browse, search, upload images to the central library
- Hard-delete images

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are images in the admin library shared across all companies or scoped?

---

### /admin/images/[id]

**File:** `app/(platform)/admin/images/[id]/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Image detail with metadata and usage

**User actions on this page:**
- View image metadata
- Re-extract metadata
- Restore soft-deleted image
- Hard-delete

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the difference between soft-delete and hard-delete for images?

---

### /admin/media

**File:** `app/(platform)/admin/media/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Media assets overview (distinct from image library)

**User actions on this page:**
- View and promote media assets

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] How does /admin/media differ from /admin/images?

---

### /admin/posts

**File:** `app/(platform)/admin/posts/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** Filter params
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- All posts across all sites

**User actions on this page:**
- View and manage blog posts across all sites

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are these WordPress blog posts or social posts?

---

### /admin/posts/new

**File:** `app/(platform)/admin/posts/new/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- New post creation (cross-site)

**User actions on this page:**
- Create a new blog post (site selection step)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does this redirect to /admin/posts/[siteId]/new after site selection?

---

### /admin/posts/[siteId]/new

**File:** `app/(platform)/admin/posts/[siteId]/new/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- New post creation form for a specific site

**User actions on this page:**
- Create a new blog post for the specified site

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is AI-assisted content generation available on this form?

---

### /admin/insights

**File:** `app/(platform)/admin/insights/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Admin insights dashboard (cross-client)

**User actions on this page:**
- View insights across all clients
- Navigate to per-client insights

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can admins see individual client insights or only aggregated?

---

### /admin/insights/clients/[id]

**File:** `app/(platform)/admin/insights/clients/[id]/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Per-client insights with recommendations

**User actions on this page:**
- View and annotate recommendations
- Dismiss recommendations

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the lifecycle of a dismissed recommendation — can it be un-dismissed?

---

### /admin/insights/clients/[id]/competitors

**File:** `app/(platform)/admin/insights/clients/[id]/competitors/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Competitor management for a client

**User actions on this page:**
- Add, edit, delete competitors
- Trigger competitor scrape

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is competitor scraping triggered on add, or on a schedule?

---

### /admin/insights/compare

**File:** `app/(platform)/admin/insights/compare/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** Client/competitor selection params
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Cross-client comparison view

**User actions on this page:**
- Compare insights across clients

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What dimensions can be compared?

---

### /admin/insights/patterns

**File:** `app/(platform)/admin/insights/patterns/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Cross-client pattern library view

**User actions on this page:**
- View mined content patterns

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What patterns are mined — content structure, topic clusters, posting cadence?

---

### /admin/theming

**File:** `app/(platform)/admin/theming/page.tsx`
**Auth:** `checkAdminAccess({ requiredRoles: ["super_admin"] })` — super_admin only (KF-5)
**Search params:** `?company=` (company UUID for theming preview)
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- `ThemingClient` — per-company theme configuration
- `TListWide` — layout template

**User actions on this page:**
- Select a company from the dropdown
- Configure and preview the company's design token overrides

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are theme changes applied immediately or only on save?
- [ ] Can theme changes be reverted?

---

### /admin/errors

**File:** `app/(platform)/admin/errors/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** Filter params
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Client error log viewer

**User actions on this page:**
- View client-side error reports

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] How long are error reports retained?

---

### /admin/maintenance

**File:** `app/(platform)/admin/maintenance/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Maintenance actions overview

**User actions on this page:**
- Access maintenance tools

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What maintenance operations are available from this page?

---

### /admin/maintenance/social-connections

**File:** `app/(platform)/admin/maintenance/social-connections/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Social connection maintenance panel

**User actions on this page:**
- Reconcile connections with bundle.social
- Reattribute connections to correct profiles
- Refresh identity fingerprints

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are maintenance operations idempotent (safe to run multiple times)?

---

### /admin/system/health

**File:** `app/(platform)/admin/system/health/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- System health dashboard with service status

**User actions on this page:**
- View health events
- Resolve service health flags

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What services are monitored (bundle.social, Supabase, Vercel, etc.)?

---

### /admin/system/jobs

**File:** `app/(platform)/admin/system/jobs/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Background job queue viewer

**User actions on this page:**
- View job statuses
- (Future) retry or cancel jobs

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Which job types are visible here?

---

### /admin/email-test

**File:** `app/(platform)/admin/email-test/page.tsx`
**Auth:** `checkAdminAccess({ requiredRoles: ["super_admin"] })` — super_admin only
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Email test trigger surface

**User actions on this page:**
- Send test emails to verify email configuration

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Which email templates can be tested from this page?

---

### /admin/settings/design-system

**File:** `app/(platform)/admin/settings/design-system/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Global design system settings

**User actions on this page:**
- Configure global design system defaults

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Do global defaults override or underlay per-site settings?

---

### /admin/_internal/table-examples

**File:** `app/(platform)/admin/_internal/table-examples/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Internal UI component examples

**User actions on this page:**
- None (development reference page)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Should this page be removed from production?

---

## Optimiser

All pages call `checkAdminAccess()` (super_admin + admin).

---

### /optimiser

**File:** `app/(platform)/optimiser/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Optimiser module landing

**User actions on this page:**
- Navigate to proposals, diagnostics, clients

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the primary entry point on this page?

---

### /optimiser/proposals

**File:** `app/(platform)/optimiser/proposals/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** Filter / pagination params
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Proposals list table with status pills

**User actions on this page:**
- View all proposals
- Filter by status
- Navigate to proposal detail

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are `expired` proposals shown by default or filtered out?

---

### /optimiser/proposals/[id]

**File:** `app/(platform)/optimiser/proposals/[id]/page.tsx`
**Auth:** `checkAdminAccess()`; `notFound()` if proposal does not exist
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- `ProposalReview` — full proposal content and evidence
- `ProposalAppliedMoment` — post-apply timeline
- `ProposalRolloutLink` — staged rollout link if applicable
- `CreateVariantButton` — create A/B variant
- `PastCausalDeltasPanel` — historical causal deltas for this playbook
- `PatternPriorsPanel` — pattern priors influencing this proposal
- `TDetailSummary` — layout template

**User actions on this page:**
- Approve proposal (triggers brief generation)
- Reject proposal
- Create A/B variant
- View rollout status
- Rollback an applied proposal

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens when a proposal is in `applying` state — are action buttons disabled?
- [ ] Can a proposal in `applied_promoted` be rolled back?
- [ ] What evidence is shown in `ProposalReview` (GA4 data, Clarity heatmap link, etc.)?

---

### /optimiser/diagnostics

**File:** `app/(platform)/optimiser/diagnostics/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Optimiser health diagnostics

**User actions on this page:**
- View data sync status (GA4, Ads, Clarity, PageSpeed)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does this page surface individual client sync health or aggregate?

---

### /optimiser/change-log

**File:** `app/(platform)/optimiser/change-log/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** Filter params
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Audit log of all applied optimiser changes

**User actions on this page:**
- View change history across all clients

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does the change log show rollbacks as separate entries?

---

### /optimiser/clients/[id]/settings

**File:** `app/(platform)/optimiser/clients/[id]/settings/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Per-client optimiser settings (GA4 property, Ads customer, Clarity project)

**User actions on this page:**
- Configure data integrations for the client

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are OAuth tokens stored per-setting or globally per admin account?

---

### /optimiser/onboarding

**File:** `app/(platform)/optimiser/onboarding/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Optimiser onboarding client list

**User actions on this page:**
- View and manage client onboarding for Optimiser

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What marks a client as "onboarded" for Optimiser?

---

### /optimiser/onboarding/[id]

**File:** `app/(platform)/optimiser/onboarding/[id]/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Per-client onboarding steps

**User actions on this page:**
- Complete onboarding steps for a client

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What steps are required before Optimiser can start scoring pages for this client?

---

### /optimiser/imports/[brief_id]

**File:** `app/(platform)/optimiser/imports/[brief_id]/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Brief import review surface (Optimiser → Brief generation bridge)

**User actions on this page:**
- Review and confirm import of optimiser proposal into brief

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does the import create a new brief or append pages to an existing one?

---

### /optimiser/pages/[id]

**File:** `app/(platform)/optimiser/pages/[id]/page.tsx`
**Auth:** `checkAdminAccess()`
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Optimiser page detail (scores, proposals history, rollback)

**User actions on this page:**
- View page scores over time
- Roll back a page to previous version

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What scores are shown (PageSpeed, Clarity heatmap score, GA4 conversion rate)?

---

## Account

All pages require any authenticated platform session.

---

### /account/security

**File:** `app/(platform)/account/security/page.tsx`
**Auth:** Any authenticated user
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- `AccountSecurityForm` — change password

**User actions on this page:**
- Change password (current + new + confirm)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are existing sessions (other devices) invalidated after a password change?
- [ ] Is 2FA setup accessible from this page?

---

### /account/devices

**File:** `app/(platform)/account/devices/page.tsx`
**Auth:** Any authenticated user
**Search params:** None
**States:** loading.tsx ✓ (has loading.tsx) · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Active sessions / devices list

**User actions on this page:**
- View all active sessions
- Sign out a specific device
- Sign out all other devices

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What device metadata is captured (IP, user agent, last active)?
- [ ] Is the current session highlighted / protected from self-sign-out?

---

## Public / Token-auth

---

### /social/poster

**File:** `app/(platform)/social/poster/page.tsx`
**Auth:** Platform session required
**Search params:** None
**States:** loading.tsx ✓ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Social poster surface

**User actions on this page:**
- Post content to connected social accounts

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is this a legacy entry point or an active route?

---

### /design-system

**File:** `app/(dev)/design-system/page.tsx`
**Auth:** Gated by `NEXT_PUBLIC_SHOW_DEV_ROUTES` env var (dev/staging only)
**Search params:** None
**States:** loading.tsx ✗ · error.tsx ✗ · not-found.tsx ✗

**Major components rendered:**
- Internal design system component showcase

**User actions on this page:**
- Browse UI components and tokens

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is this page accessible in production when `NEXT_PUBLIC_SHOW_DEV_ROUTES` is unset?
