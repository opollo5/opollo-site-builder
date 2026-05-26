# Roles and Permissions Inventory

This document catalogs every role in the platform, what it gates, and where
enforcement happens. Two independent role systems coexist: the **Opollo staff
system** (opollo_users) and the **platform company system** (platform_company_users).

> **SKELETON** — "EXPECTED BEHAVIOUR" sections are empty checkboxes for Steven
> to fill during Phase 2.

---

## Overview: Two Role Systems

| System | Table | Column | Roles | Who holds it |
|---|---|---|---|---|
| Opollo staff | `opollo_users` | `role` | `super_admin`, `admin`, `user` | Opollo employees and operators |
| Company member | `platform_company_users` | `role` | `admin`, `approver`, `editor`, `viewer` | Customer company members |

These systems are orthogonal. An Opollo staff member who navigates to
`/company/social/calendar` via admin impersonation bypasses the company-member
gate via `is_opollo_staff()` RLS helper. Customer users have no row in
`opollo_users`.

---

## System 1 — Opollo Staff Roles

**Source of truth:** `opollo_users.role`
**Defined at:** `lib/auth.ts` — `export type Role = "super_admin" | "admin" | "user"`
**Enforcement lib:** `lib/admin-gate.ts` — `checkAdminAccess()` + `lib/auth.ts` — `requireRole()`

### Role: super_admin

**Allowed routes (in addition to admin):**
- All admin routes (same as admin)
- `DebugFooter` rendered in admin layout — exposes build SHA, env, user email/role
- `/admin/system/health` — requires `super_admin` explicitly (see `app/(platform)/admin/system/health/page.tsx`)

**API enforcement:**
- `requireRole(user, ["super_admin"])` — used for most sensitive admin operations
- `checkAdminAccess({ requiredRoles: ["super_admin"] })` on system health page

**DB enforcement:**
- Most admin API routes gate via application-layer `requireAdminForApi()` (not RLS)
- `is_opollo_staff()` DB function enables RLS bypass on all platform tables

### Role: admin

**Allowed routes:**
- `/admin/*` — via `checkAdminAccess()` which allows `["super_admin", "admin"]`
- `/admin/users` — requires admin (not just operator)
- `/admin/companies/*` — allowed
- All site management, batch, images, design system routes

**API enforcement:**
- `requireAdminForApi()` in `lib/auth.ts` — requires `["super_admin", "admin"]`
- `checkAdminAccess()` — same set

**NOT allowed:**
- System health page (`super_admin` only)
- `DebugFooter` is hidden for `admin` (only shown for `super_admin` or when no user)

### Role: user

**Allowed routes:** No admin routes. Redirected to `/` by `checkAdminAccess()`.
**Note:** `user` role is declared in the type but appears unused in current routing logic.
The admin layout's `checkAdminAccess()` only allows `super_admin` and `admin`.

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is `user` role used anywhere? Should it gate any routes?
- [ ] What should a `user`-role Opollo account be able to do?

---

## System 2 — Platform Company Roles

**Source of truth:** `platform_company_users.role`
**Defined at:** `lib/platform/auth/types.ts` — `export type CompanyRole = "admin" | "approver" | "editor" | "viewer"`
**Enforcement lib:** `lib/platform/auth/permissions.ts` — `ACTION_MIN_ROLE` + `roleSatisfies()`
**Key helper:** `lib/platform/auth/index.ts` — `canDo(action, session)` which calls `hasCompanyRole(min_role)`
**DB helper:** `has_company_role(company_id uuid, min_role text)` SQL function (RLS policies)

### Role Hierarchy

`admin` > `approver` > `editor` > `viewer`

Rank values (from `lib/platform/auth/permissions.ts:4-10`):
```
admin: 4, approver: 3, editor: 2, viewer: 1
```

### Permission → Minimum Role Mapping

**Source:** `lib/platform/auth/permissions.ts:18-38`

| Permission Action | Minimum Role | Description |
|---|---|---|
| `manage_users` | admin | Invite, revoke, change roles |
| `edit_company_settings` | admin | Edit company name, brand, etc. |
| `manage_connections` | admin | Add/remove social connections |
| `reconnect_connection` | editor | Re-OAuth an expired connection |
| `manage_invitations` | admin | Send/cancel company invitations |
| `create_post` | editor | Create a new social post draft |
| `edit_post` | editor | Edit an existing draft |
| `submit_for_approval` | editor | Send post for approver review |
| `approve_post` | approver | Approve a pending_approval post |
| `reject_post` | approver | Reject a pending_approval post |
| `schedule_post` | approver | Schedule a post for publishing |
| `view_calendar` | viewer | Navigate to /company/social/calendar |
| `receive_connection_alerts` | admin | Connection health alerts |
| `view_insights` | viewer | View social insights/analytics |
| `manage_insights` | admin | Configure insights, manage competitors |

### Role: admin (company)

**Allowed pages:**
- All `/company/*` pages
- `/company/social/connections` — full management (connect, disconnect, reconnect)
- `/company/users` — manage members and invitations
- `/company/settings/brand` — edit company settings
- `/company/settings/insights` — manage insights configuration

**API routes requiring admin:**
- `POST /api/platform/social/connections/connect` — new connection
- `DELETE /api/platform/social/connections/[id]/disconnect` — full disconnect
- `POST /api/platform/invitations` — invite new member
- `DELETE /api/platform/invitations/[id]` — cancel invitation
- `PATCH /api/platform/invitations/[id]` — modify invitation
- Company settings mutations

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens when a company admin is demoted to viewer mid-session?
- [ ] Can a company admin invite someone with a higher role than their own?
- [ ] What happens if the last company admin is revoked?
- [ ] Is there an audit log for role changes?

### Role: approver (company)

**Allowed pages:**
- All viewer + editor pages
- Approval flow pages

**Allowed actions beyond editor:**
- Approve/reject posts in `pending_approval` state
- Schedule posts (`schedule_post` permission)
- Send posts directly without approval step (if approval not required)

**API routes requiring approver+:**
- `POST /api/platform/social/posts/[id]/approve`
- `POST /api/platform/social/posts/[id]/reject`
- `POST /api/platform/social/posts/[id]/schedule`
- `PATCH /api/platform/social/drafts/[id]` with `mode=schedule`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can an approver approve their own post?
- [ ] What notification fires when an approver approves/rejects?
- [ ] Can an approver demote themselves to editor?

### Role: editor (company)

**Allowed pages:**
- All viewer pages
- `/company/social/calendar` — can open composer, create posts
- `/company/social/posts` — can create, edit drafts
- Composer overlay — full edit mode

**Allowed actions:**
- Create new post drafts
- Edit existing drafts
- Submit drafts for approval
- Reconnect expired connections (`reconnect_connection`)
- View analytics / calendar

**NOT allowed:**
- Approve or schedule posts (requires approver+)
- Manage company settings
- Manage connections (add/remove)
- Invite/revoke users

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What does an editor see if they try to click "Schedule" without approval enabled?
- [ ] Can an editor delete their own draft?
- [ ] What does the composer look like for an editor vs approver?

### Role: viewer (company)

**Allowed pages:**
- `/company/social/calendar` — read-only calendar view
- `/company/social/posts` — read-only posts list
- `/company/social/analytics` — view analytics
- `/company/social/insights` — view insights
- `/company/social/connections` — view connections (no manage)

**NOT allowed:**
- Create, edit, or delete any posts
- Open composer in edit mode
- Manage connections, users, or settings

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does the calendar show the "New post" button for viewers?
- [ ] What happens if a viewer navigates directly to `/company/social/posts/[id]` for a draft?
- [ ] What is the visual indicator that a user is in read-only mode?

---

## Cross-system: Opollo Staff as Company Members

**Source:** `lib/platform/auth/current-user.ts:111-132`

When an Opollo staff member (`is_opollo_staff=true` in `platform_users`) navigates
to a company context without being in `platform_company_users`, the system
grants them an implicit `admin` role via `getCurrentPlatformSession()` override.

```
// lib/platform/auth/current-user.ts:132
return { companyId: selectedId, role: "admin" };
```

This means Opollo staff with no company membership behave as company admins for
all customer companies they navigate to.

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Should Opollo staff impersonation be audit-logged?
- [ ] Is the staff override shown anywhere in the UI?
- [ ] Can an Opollo staff member accidentally make mutations as a company admin?
- [ ] Should the implicit admin grant be restricted to certain roles?

---

## Route-Level Auth Summary

### Admin layout gate (`app/(platform)/admin/layout.tsx`)
**File:** `lib/admin-gate.ts:checkAdminAccess()`
- Default: requires `["super_admin", "admin"]`
- Some pages override with stricter roles via `checkAdminAccess({ requiredRoles: [...] })`
- If `FEATURE_SUPABASE_AUTH` is off: allows everyone (legacy Basic Auth handles it)
- If kill switch is on: allows everyone (break-glass)

### Platform layout gate (company routes)
**File:** `lib/platform/auth/current-user.ts:getCurrentPlatformSession()`
- No session → redirected to `/login?next=...`
- No company membership → "Not provisioned" error envelope
- Company membership → role threaded through for per-action checks

### Public / token-gated routes
**No session required:**
- `/viewer/[token]` — share link calendar (token expires)
- `/review/[token]` — post review link (JWT, 14-day expiry)
- `/approve/[token]` — approval decision (token-based, single-use)
- `/invite/[token]` — site invite accept

### API auth patterns
**File:** `lib/auth.ts:requireAdminForApi()` and `lib/platform/auth/api-gate.ts`

| Pattern | Used by | Enforces |
|---|---|---|
| `requireAdminForApi()` | All `/api/admin/*` routes | opollo_users: admin or super_admin |
| `requirePlatformAuth()` | Most `/api/platform/*` routes | platform session + company membership |
| `canDo(action)` | Platform API business logic | CompanyRole ≥ minRoleFor(action) |
| Cron-secret header | `/api/cron/*`, `/api/internal/cron/*` | `X-Cron-Secret` matches env var |
| Token verification | `/api/approve/[token]/decision` | HMAC-signed token |
| Webhook signature | `/api/webhooks/*` | Bundle.social or QStash HMAC |
| None (public) | `/api/health`, `/api/auth/*` | No auth |

---

## Database-Level Enforcement (RLS)

Row-Level Security policies in Supabase enforce multi-tenant isolation at the
DB layer, independent of application-level checks.

**Key RLS helpers (supabase/migrations/0070_platform_foundation.sql):**

| Function | Returns | Used in |
|---|---|---|
| `auth.uid()` | Current auth user UUID | All user-scoped policies |
| `is_opollo_staff()` | boolean | Staff bypass on all platform tables |
| `is_company_member(company_id)` | boolean | Read policies on company data |
| `has_company_role(company_id, min_role)` | boolean | Write policies (admin-only mutations) |
| `current_user_company()` | UUID | Single-company user context |

**Tables with RLS:**
- `platform_companies` — staff write, member read
- `platform_company_users` — admin write, member read
- `social_post_drafts` / `social_post_master` — company member read/write
- `social_connections` — admin write, member read
- `social_media_assets` — member scoped
- `cap_subscriptions`, `cap_campaigns`, `cap_campaign_posts` — company scoped

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Should cross-tenant reads be blocked at RLS even when the app logic allows?
- [ ] Are there tables missing RLS that should have it?
- [ ] What is the expected behaviour when a revoked user's session is still active?
- [ ] Is there an audit trail for RLS policy changes?
- [ ] What should happen when a user is removed from a company — immediate session invalidation?

---

## Known Role Enforcement Gaps

See `docs/inventory/discovered-issues.md` for a complete list. Key gaps:

1. **`user` role orphaned** — declared in `lib/auth.ts` type but no routes explicitly allow it and no UI creates it. Either unused or a future placeholder.
2. **No server-side check on `schedule_post` in bulk CSV upload** — bulk route (`/api/platform/social/drafts/bulk`) does not verify the caller has `schedule_post` permission when setting `state='scheduled'` (relates to G8 / G10 in state-machine backlog).
3. **Implicit staff admin grant not logged** — Opollo staff navigating to customer companies get admin rights without an audit log entry.

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Should the `user` role be removed or given explicit routes?
- [ ] Should bulk CSV upload verify `schedule_post` permission?
- [ ] Should staff company access be logged?
