# Roles and Permissions

**Generated:** 2026-05-25 via codebase analysis.
**Status:** Phase 1 skeleton — gates extracted from source files. `EXPECTED BEHAVIOUR` sections are empty for Steven to fill.

---

## Table of Contents

1. [Two Role Systems](#two-role-systems)
2. [Operator Roles (opollo_users.role)](#operator-roles-opollo_usersrole)
   - [super_admin](#super_admin)
   - [admin](#admin)
   - [user](#user-operator)
3. [Platform Roles (platform_company_users.role)](#platform-roles-platform_company_usersrole)
   - [Role Hierarchy](#role-hierarchy)
   - [admin (platform)](#admin-platform)
   - [approver](#approver)
   - [editor](#editor)
   - [viewer](#viewer)
4. [Special Cases](#special-cases)
   - [is_opollo_staff](#is_opollo_staff)
5. [Action Permission Matrix](#action-permission-matrix)
6. [Gate Functions Reference](#gate-functions-reference)

---

## Two Role Systems

This codebase has two independent role systems that coexist for different user types:

| System | Table | Column | User type |
|--------|-------|--------|-----------|
| **Operator** | `opollo_users` | `role` | Opollo staff (internal) — access to `/admin/*`, `/optimiser/*` |
| **Platform** | `platform_company_users` | `role` | Customer company users — access to `/company/*` |

**Key distinction:** Opollo staff have BOTH an `opollo_users` row AND a `platform_users` row with `is_opollo_staff=true`. Customer users only have `platform_users` + `platform_company_users`.

**Source:** `lib/platform/auth/types.ts` (lines 1–7), `lib/platform/auth/current-user.ts`

---

## Operator Roles (opollo_users.role)

### super_admin

**Source:** `opollo_users.role = 'super_admin'`
**Gate function:** `checkAdminAccess({ requiredRoles: ["super_admin"] })` in `lib/admin-gate.ts`; `requireAdminForApi({ roles: ["super_admin"] })` in `lib/admin-api-gate.ts`

**Description:** Top-tier operator role. Reserved for `hi@opollo.com` (the primary operator). Cannot be assigned via the admin UI — the `guard_super_admin` DB trigger blocks demotion/assignment at the database level. Only accessible programmatically.

**All routes accessible to super_admin (that admin cannot access):**

| Route | File | Notes |
|-------|------|-------|
| `/admin/theming` | `app/(platform)/admin/theming/page.tsx` | Design-system token editor (KF-5) |
| `/admin/email-test` | `app/(platform)/admin/email-test/page.tsx` | Send test emails (AUTH-FOUNDATION P3.4) |

**API endpoints gated super_admin-only:**

| Method + Path | File | Notes |
|--------------|------|-------|
| `GET /api/admin/users/list` | `app/api/admin/users/list/route.ts` | User list — `requireAdminForApi({ roles: ["super_admin"] })` |

**Inherits all `admin` routes** (see below).

**Role assignment:**
- `super_admin` cannot be assigned via `PATCH /api/admin/users/[id]/role` — the route only accepts `"admin" | "user"` in its `RoleSchema`
- The DB-level `guard_super_admin` trigger enforces this at the database layer too

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can a `super_admin` demote themselves?
- [ ] Can a `super_admin` see and manage other `super_admin` users?
- [ ] What happens if `hi@opollo.com` signs in to a fresh deployment without a `super_admin` row — does auto-provisioning kick in?

---

### admin

**Source:** `opollo_users.role = 'admin'`
**Gate function:** `checkAdminAccess()` defaults to `ADMIN_ROLES = ["super_admin", "admin"]`; `requireAdminForApi()` without `roles` override also uses this default.

**Description:** Standard operator role for Opollo staff who need access to admin and optimiser surfaces but are not the top-tier account holder.

**Routes accessible to admin (and super_admin):**

| Route | File |
|-------|------|
| `/admin/sites` | `app/(platform)/admin/sites/page.tsx` |
| `/admin/sites/[id]` | `app/(platform)/admin/sites/[id]/page.tsx` |
| `/admin/sites/[id]/settings` | `app/(platform)/admin/sites/[id]/settings/page.tsx` |
| `/admin/sites/[id]/appearance` | `app/(platform)/admin/sites/[id]/appearance/page.tsx` |
| `/admin/sites/[id]/setup` | `app/(platform)/admin/sites/[id]/setup/page.tsx` |
| `/admin/sites/[id]/setup/extract` | `app/(platform)/admin/sites/[id]/setup/extract/page.tsx` |
| `/admin/sites/[id]/onboarding` | `app/(platform)/admin/sites/[id]/onboarding/page.tsx` |
| `/admin/sites/[id]/edit` | `app/(platform)/admin/sites/[id]/edit/page.tsx` |
| `/admin/sites/[id]/pages` | `app/(platform)/admin/sites/[id]/pages/page.tsx` |
| `/admin/sites/[id]/pages/[pageId]` | `app/(platform)/admin/sites/[id]/pages/[pageId]/page.tsx` |
| `/admin/sites/[id]/posts` | `app/(platform)/admin/sites/[id]/posts/page.tsx` |
| `/admin/sites/[id]/posts/new` | `app/(platform)/admin/sites/[id]/posts/new/page.tsx` |
| `/admin/sites/[id]/posts/[post_id]` | `app/(platform)/admin/sites/[id]/posts/[post_id]/page.tsx` |
| `/admin/sites/new` | `app/(platform)/admin/sites/new/page.tsx` |
| `/admin/batches` | `app/(platform)/admin/batches/page.tsx` |
| `/admin/batches/[siteId]` | `app/(platform)/admin/batches/[siteId]/page.tsx` |
| `/admin/batches/[siteId]/[batchId]` | `app/(platform)/admin/batches/[siteId]/[batchId]/page.tsx` |
| `/admin/posts` | `app/(platform)/admin/posts/page.tsx` |
| `/admin/posts/[siteId]/new` | `app/(platform)/admin/posts/[siteId]/new/page.tsx` |
| `/admin/images` | `app/(platform)/admin/images/page.tsx` |
| `/admin/images/[id]` | `app/(platform)/admin/images/[id]/page.tsx` |
| `/admin/users` (UI only) | `app/(platform)/admin/users/page.tsx` — rendered but data from `GET /api/admin/users/list` is super_admin-only |
| `/admin/users/audit` | `app/(platform)/admin/users/audit/page.tsx` |
| `/admin/companies` | `app/(platform)/admin/companies/page.tsx` |
| `/admin/errors` | `app/(platform)/admin/errors/page.tsx` |
| `/admin/maintenance` | `app/(platform)/admin/maintenance/page.tsx` |
| `/admin/system/health` | `app/(platform)/admin/system/health/page.tsx` |
| `/admin/system/jobs` | `app/(platform)/admin/system/jobs/page.tsx` |
| `/admin/settings/design-system` | `app/(platform)/admin/settings/design-system/page.tsx` |
| `/optimiser/*` | Multiple pages under `app/(platform)/optimiser/` |

**API endpoints accessible to admin:**

| Method + Path | Notes |
|--------------|-------|
| `POST /api/admin/users/invite` | Invite new operators |
| `PATCH /api/admin/users/[id]/role` | Change `admin` ↔ `user` (not super_admin) |
| `POST /api/admin/users/[id]/revoke` | Revoke operator access |
| `POST /api/admin/users/[id]/reinstate` | Reinstate revoked operator |
| All `/api/admin/sites/*` | Site CRUD |
| All `/api/admin/images/*` | Image library |
| All `/api/admin/companies/*` | Company management |

**Cannot access (super_admin only):**
- `/admin/theming`
- `/admin/email-test`
- `GET /api/admin/users/list`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] When an `admin` visits `/admin/users`, what do they see (empty list or an error)?
- [ ] Can `admin` role view the email-test page at all, or does it redirect?
- [ ] What is the redirect destination for an `admin` who tries to access a `super_admin`-only page?

---

### user (operator)

**Source:** `opollo_users.role = 'user'`
**Gate function:** No dedicated gate — user is the lowest operator role and is excluded from `ADMIN_ROLES`. Access is gated by the absence of the user from admin routes.

**Description:** Operator-tier user with no admin surface access. Previously called "operator" (migration 0057 renamed `admin+operator → super_admin+admin`; the old "viewer" became `user`). Likely unused in practice — Opollo staff are either `admin` or `super_admin`.

**Accessible routes:**
- `/account/security` — change password (`app/(platform)/account/security/page.tsx`)
- `/account/devices` — manage devices

**Cannot access:**
- Any `/admin/*` route
- Any `/optimiser/*` route

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is the `user` operator role actively used, or is it vestigial from the migration?
- [ ] What does a `user`-role operator see on login — the chat builder, or a blank screen?

---

## Platform Roles (platform_company_users.role)

### Role Hierarchy

**Source:** `lib/platform/auth/permissions.ts` (lines 1–11)

```
viewer (1) < editor (2) < approver (3) < admin (4)
```

All roles are cumulative — a higher role can perform everything a lower role can. The `roleSatisfies(have, need)` function mirrors the `has_company_role` SQL helper.

---

### admin (platform)

**Source:** `platform_company_users.role = 'admin'`
**Gate:** `hasCompanyRole(companyId, "admin")` via `lib/platform/auth/helpers.ts`; API gates via `requireCanDoForApi(companyId, action)` in `lib/platform/auth/api-gate.ts`

**Description:** Full control over the company's platform workspace. Manages users, connections, settings, and can perform all lower-role actions.

**Exclusive actions (min role = admin):**

| Action | What it gates |
|--------|---------------|
| `manage_users` | `/company/users`, invite/remove users from the company |
| `edit_company_settings` | `/company/settings/brand`, `/company/settings/insights` |
| `manage_connections` | Create new social connections, delete connections |
| `manage_invitations` | `/company/social/sharing`, create/revoke viewer links |
| `receive_connection_alerts` | Connection health email/notification alerts |
| `view_insights` | View analytics pages — also available to viewer+ |
| `manage_insights` | Configure insights settings |

**Inherits all approver, editor, and viewer actions.**

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can an `admin` member assign another member to `admin` role?
- [ ] Is there a maximum number of `admin` members per company?
- [ ] Does `manage_connections` also allow reconnecting an expired connection, or is that `editor` minimum?

---

### approver

**Source:** `platform_company_users.role = 'approver'`
**Gate:** `hasCompanyRole(companyId, "approver")`

**Description:** Approves and schedules posts. Cannot manage team members or connections.

**Exclusive actions (min role = approver):**

| Action | What it gates |
|--------|---------------|
| `approve_post` | Approve posts in approval queue (`/company/social/posts?state=pending_client_approval`) |
| `reject_post` | Reject posts (same surface) |
| `schedule_post` | Set `scheduled_at` on approved posts |

**Inherits all editor and viewer actions.**

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] When an `approver` approves a post, does it move directly to `scheduled` or to `approved`?
- [ ] Can an `approver` also create new posts (inheriting `create_post` from editor)?

---

### editor

**Source:** `platform_company_users.role = 'editor'`
**Gate:** `hasCompanyRole(companyId, "editor")`

**Description:** Creates and edits content, submits posts for approval, and can reconnect expired connections.

**Exclusive actions (min role = editor):**

| Action | What it gates |
|--------|---------------|
| `create_post` | "New post" button; `POST /api/platform/social/drafts` |
| `edit_post` | Edit draft content; `PATCH /api/platform/social/drafts/[id]` |
| `submit_for_approval` | Submit drafts for approval workflow |
| `reconnect_connection` | Re-OAuth an expired/disconnected connection (not create/delete — those are admin) |

**Inherits all viewer actions.**

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can an `editor` edit their own posts after submitting for approval?
- [ ] Can an `editor` cancel an approval request (pull back a post)?
- [ ] Can an `editor` see posts created by other team members?
- [ ] When an `editor` reconnects a connection, do they need to be the original connection owner?

---

### viewer

**Source:** `platform_company_users.role = 'viewer'`
**Gate:** `hasCompanyRole(companyId, "viewer")`

**Description:** Read-only access to the social calendar and insights.

**Exclusive actions (min role = viewer):**

| Action | What it gates |
|--------|---------------|
| `view_calendar` | `/company/social/calendar`, view posts list |
| `view_insights` | `/company/social/analytics`, `/company/social/insights` |

**No write actions available at viewer level.**

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can a `viewer` see post content (full text, media) or only metadata (status, date)?
- [ ] Can a `viewer` access `/company/social/posts/[id]` for read-only detail view?
- [ ] Can a `viewer` see other team members in `/company/users`?

---

## Special Cases

### is_opollo_staff

**Source:** `platform_users.is_opollo_staff = true`
**SQL helper:** `is_opollo_staff()` RPC function (migration 0070)
**TypeScript wrapper:** `lib/platform/auth/helpers.ts:isOpolloStaff()`

**Description:** Opollo operators who access the platform module do so via this flag, not via a `platform_company_users` row. Staff with `is_opollo_staff=true` bypass all company-role permission checks and have full access to all platform actions for any company.

**Auto-provisioning:** When an operator (`opollo_users`) first accesses a platform route, `lib/platform/auth/current-user.ts` auto-provisions a `platform_users` row with `is_opollo_staff=true` via upsert if it is missing.

**Staff-selected company cookie:**
- Cookie name: `opollo_selected_company_id`
- Allows staff to "view as" a specific company without permanently joining it
- Staff retain `is_opollo_staff=true` while using this cookie

**Implication:** Opollo staff have BOTH:
- An `opollo_users` row (for `/admin/*` and `/optimiser/*` access, gated by `admin` / `super_admin` role)
- A `platform_users` row with `is_opollo_staff=true` (for `/company/*` access, bypassing all company-role checks)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] When a staff member uses the selected-company cookie, do their actions appear as that company's own admin in audit logs?
- [ ] Is there a UI in the admin panel to set the selected-company cookie, or is it set manually?
- [ ] When `is_opollo_staff=true` user takes a destructive action (e.g. deletes a post), who does the audit log attribute it to?

---

## Action Permission Matrix

**Source:** `lib/platform/auth/permissions.ts` — `ACTION_MIN_ROLE` map (lines 18–38)

| Action | Min Role | viewer | editor | approver | admin |
|--------|----------|--------|--------|----------|-------|
| `view_calendar` | viewer | YES | YES | YES | YES |
| `view_insights` | viewer | YES | YES | YES | YES |
| `create_post` | editor | NO | YES | YES | YES |
| `edit_post` | editor | NO | YES | YES | YES |
| `submit_for_approval` | editor | NO | YES | YES | YES |
| `reconnect_connection` | editor | NO | YES | YES | YES |
| `approve_post` | approver | NO | NO | YES | YES |
| `reject_post` | approver | NO | NO | YES | YES |
| `schedule_post` | approver | NO | NO | YES | YES |
| `manage_users` | admin | NO | NO | NO | YES |
| `edit_company_settings` | admin | NO | NO | NO | YES |
| `manage_connections` | admin | NO | NO | NO | YES |
| `manage_invitations` | admin | NO | NO | NO | YES |
| `receive_connection_alerts` | admin | NO | NO | NO | YES |
| `manage_insights` | admin | NO | NO | NO | YES |

Plus `is_opollo_staff=true` bypasses all rows → YES for all actions.

---

## Gate Functions Reference

### Operator Layer

| Function | File | Usage |
|----------|------|-------|
| `checkAdminAccess(opts?)` | `lib/admin-gate.ts` | Server Component / layout gates; returns `{kind: "allow" \| "redirect"}` |
| `requireAdminForApi(opts?)` | `lib/admin-api-gate.ts` | Route handler gates; returns `{kind: "allow" \| "deny"}` |
| `ADMIN_ROLES` | `lib/admin-gate.ts` (line 55) | `["super_admin", "admin"]` — default allowed set |

### Platform Layer

| Function | File | Usage |
|----------|------|-------|
| `isOpolloStaff(client?)` | `lib/platform/auth/helpers.ts` | Check if current user is Opollo staff |
| `isCompanyMember(companyId, client?)` | `lib/platform/auth/helpers.ts` | Check if user is a member of a company |
| `hasCompanyRole(companyId, minRole, client?)` | `lib/platform/auth/helpers.ts` | Check if user meets minimum role threshold |
| `currentUserCompanyId(client?)` | `lib/platform/auth/helpers.ts` | Get company ID for current user |
| `getCurrentPlatformSession(client?)` | `lib/platform/auth/current-user.ts` | Full session resolution: identity + staff flag + company membership |
| `requireCanDoForApi(companyId, action)` | `lib/platform/auth/api-gate.ts` | Route handler gate for platform actions; returns `{kind: "allow" \| "deny"}` |
| `minRoleFor(action)` | `lib/platform/auth/permissions.ts` | Returns the minimum `CompanyRole` for a given action |
| `roleSatisfies(have, need)` | `lib/platform/auth/permissions.ts` | Returns true if `have` rank >= `need` rank |

### SQL-Layer Helpers (migration 0070)

| SQL Helper | Used via RPC |
|-----------|-------------|
| `is_opollo_staff()` | `supabase.rpc("is_opollo_staff")` |
| `is_company_member(company uuid)` | `supabase.rpc("is_company_member", { company })` |
| `has_company_role(company uuid, min_role text)` | `supabase.rpc("has_company_role", { company, min_role })` |
| `current_user_company()` | `supabase.rpc("current_user_company")` |

All SQL helpers coalesce NULL → false; they never raise errors. TypeScript wrappers return `false` / `null` on RPC error.
