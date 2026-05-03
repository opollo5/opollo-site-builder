---
name: platform-customer-management
description: Use this skill whenever working on the Opollo platform layer — companies, users, roles, invitations, notifications, or auth. Trigger on any work in lib/platform/ (excluding lib/platform/brand/ which has its own skill), app/admin/platform/, app/customer/, or app/api/platform/. Also trigger on requireCompanyContext, canDo, getCurrentCompany, platform_companies, platform_users, platform_company_users, platform_invitations, or platform_notifications. The platform layer is shared infrastructure — getting it wrong leaks data across companies or breaks every product that depends on it.
---

# Platform Customer Management

The platform layer owns customer companies, users, roles, invitations, and notifications. It does NOT own brand (see platform-brand-governance skill) or product-specific data.

**This is a separate user system from the existing operator system (`opollo_users`).** Customer users are `platform_users`. Operators are `opollo_users`. They never mix.

## Auth gate layering

Customer-facing routes (`/customer/*`) and operator routes that view customer data (`/admin/platform/*`) use different gates:

```typescript
// /admin/platform/companies/[companyId]/route.ts
// Opollo staff managing customer data — operator gate first, then company context
import { requireAdminForApi } from '@/lib/admin-api-gate';       // existing gate
import { requireCompanyContext } from '@/lib/platform/auth/company-context';

export async function GET(req: Request, { params }: { params: { companyId: string } }) {
  await requireAdminForApi(req);                                   // operator auth first
  const { companyId } = await requireCompanyContext(params.companyId);
}

// /customer/settings/users/route.ts
// Customer user accessing own company — customer gate only
import { requireCustomerAuth } from '@/lib/platform/auth/customer-gate';
import { requireCompanyContext } from '@/lib/platform/auth/company-context';

export async function GET(req: Request) {
  await requireCustomerAuth(req);                                  // customer auth (separate from admin gate)
  const { companyId } = await requireCompanyContext();             // no URL param — derived from session
}
```

**Never reuse `checkAdminAccess` / `requireAdminForApi` for customer routes.** Different gate, different layout, different role system.

## requireCompanyContext

```typescript
// lib/platform/auth/company-context.ts
export async function requireCompanyContext(urlCompanyId?: string) {
  const user = await getAuthUser();  // throws 401 if not authenticated as platform_user

  if (user.is_opollo_staff) {
    if (!urlCompanyId) throw new HttpError(400, 'company_id required for staff');
    const company = await getCompanyActive(urlCompanyId);
    if (!company) throw new HttpError(404, 'Company not found');
    return { companyId: urlCompanyId, isOpolloStaff: true };
  }

  // Customer user: return their fixed company, ignore any URL company_id
  const membership = await getActiveCompanyMembership(user.id);
  if (!membership) throw new HttpError(403, 'No company membership');
  return { companyId: membership.company_id, isOpolloStaff: false };
}
```

**Never trust `company_id` from request bodies.** Always derive from URL path + auth identity.

## canDo — permission checks at route boundary only

```typescript
// lib/platform/auth/permissions.ts
export async function canDo(
  companyId: string,
  action: PlatformAction,
  opts?: { asUserId?: string }
): Promise<boolean>

type PlatformAction =
  | 'manage_users'        // Admin only
  | 'manage_connections'  // Admin only
  | 'manage_brand'        // Admin only (content_restrictions requires + staff)
  | 'approve_posts'       // Admin + Approver
  | 'submit_posts'        // Admin + Approver + Editor
  | 'schedule_posts'      // Admin + Approver
  | 'generate_images'     // Admin + Approver + Editor
  | 'view_content'        // All roles

// Always at the route boundary, never inside layer functions
export async function POST(req: Request) {
  const { companyId } = await requireCompanyContext();
  if (!(await canDo(companyId, 'manage_users'))) {
    return new Response('Forbidden', { status: 403 });
  }
  // layer code from here assumes permission was verified
}
```

Opollo staff bypass all `canDo` checks — they have full access.

## version_lock — every mutation

```typescript
// lib/platform/companies/index.ts
export async function updateCompany(id: string, currentVersionLock: number, data: Partial<Company>, updatedBy: string) {
  const supabase = getServiceRoleClient();
  const { data: updated, error } = await supabase
    .from('platform_companies')
    .update({ ...data, version_lock: currentVersionLock + 1, updated_by: updatedBy })
    .eq('id', id)
    .eq('version_lock', currentVersionLock)
    .select()
    .single();

  if (!updated) {
    throw new VersionConflictError();  // caller returns 409
  }
  return updated;
}
```

Zero rows returned = VERSION_CONFLICT. Return HTTP 409 `{ error: 'VERSION_CONFLICT' }`. Client refreshes and retries.

## Soft delete

```typescript
// Never hard-delete operator-visible entities
export async function removeCompanyMember(membershipId: string, currentVersionLock: number, actorId: string) {
  const supabase = getServiceRoleClient();
  await supabase
    .from('platform_company_users')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: actorId,
      version_lock: currentVersionLock + 1,
    })
    .eq('id', membershipId)
    .eq('version_lock', currentVersionLock);
}

// Always query _active views
const { data } = await supabase
  .from('platform_companies_active')   // use _active view, not raw table
  .select('*')
  .eq('id', companyId)
  .single();
```

## Logging — lib/logger.ts only

```typescript
// ✅ CORRECT
import { logger } from '@/lib/logger';
logger.info('Invitation sent', { companyId, email, role, requestId });
logger.error('Company creation failed', { error: err.message, companyId });

// ❌ WRONG — blocked by audit:static
console.log('Invitation sent');
console.error('Failed');
```

## Email — lib/email/sendgrid.ts only

```typescript
// ✅ CORRECT — go through dispatch → lib/email/sendgrid.ts
import { dispatch } from '@/lib/platform/notifications/dispatch';

await dispatch('invitation_sent', [
  { email: inviteEmail }   // no userId for non-users
], { companyName, role, acceptUrl, expiresAt });

// ❌ WRONG — direct SendGrid import is a code-review block
import sgMail from '@sendgrid/mail';
```

`lib/email/sendgrid.ts` and `lib/email/templates/base.ts` are the ONLY files that may import `@sendgrid/mail`. Every send writes to `platform_email_log`.

## Database access

```typescript
// API routes: PostgREST via service role
import { getServiceRoleClient } from '@/lib/supabase';
const supabase = getServiceRoleClient();

// Workers needing SKIP LOCKED (future social publish queue):
import { requireDbConfig } from '@/lib/db-direct';
const db = await requireDbConfig();
// Never: new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
```

## Company creation sequence (always in this order)

1. INSERT `platform_companies` row
2. INSERT `platform_product_subscriptions` rows (which products did they buy?)
3. INSERT initial `platform_brand_profiles` row (minimum: company name + version 1)
4. Send invitation via `dispatch('invitation_sent', ...)` for first Admin user

Never skip step 3 — every product expects a brand profile to exist (may be empty, but the row must exist).

## Invitations

```typescript
// lib/platform/invitations/index.ts
export async function sendInvitation(input: {
  companyId: string;
  email: string;
  role: CompanyRole;
  invitedBy: string;
}): Promise<Invitation>
```

- 32-byte URL-safe base64 token; hash stored in `token_hash`, raw token in email only
- Link: `https://app.opollo.com/invite/{rawToken}`
- Expiry: 14 days
- Day-3 reminder: QStash job queued at send time, fires if `accepted_at` still null
- Day-14 expiry notify: QStash job fires at day 14 if status still `pending`
- Duplicate active invitations to same email+company blocked by unique index — revoke existing before re-inviting

## Notifications

In-app notification rows and originating events must be in the **same DB transaction**. Email is fire-and-forget through QStash.

```typescript
// lib/platform/notifications/dispatch.ts
export async function dispatch(
  type: NotificationType,
  recipients: Array<{ userId?: string; email: string }>,
  data: Record<string, unknown>
): Promise<void>

// Platform users → in-app row (same transaction) + email via QStash
// Non-users (external approvers, Opollo admin alerts) → email only, no in-app row
```

Critical notifications (`is_critical: true` on `platform_email_log`) alert Opollo admins if all QStash retries exhaust.

## Route layout

```
/admin/platform/              ← Opollo staff: operator view of customer data
  companies/                  ← list all companies
  companies/[id]/             ← company detail, brand, subscriptions

/customer/                    ← customer-facing: different layout shell, different auth gate
  dashboard/
  settings/brand/
  settings/users/
  social/posts/
  social/calendar/
  image/

/invite/[token]/              ← invitation acceptance (no auth required)
/review/[token]/              ← magic-link approval (no auth session)
/calendar/[token]/            ← magic-link calendar (no auth session)
```

`/customer/*` must have a different layout (`app/customer/layout.tsx`) from `/admin/` — no admin sidebar, customer chrome only.

## What lives where

```
lib/platform/
  auth/
    company-context.ts    — requireCompanyContext()
    customer-gate.ts      — requireCustomerAuth() for /customer/* routes
    permissions.ts        — canDo(), role checks
    session.ts            — getAuthUser(), getPlatformUser()
  companies/              — getCompany, listCompanies, createCompany, updateCompany
  users/                  — getPlatformUser, updateUserProfile
  invitations/            — sendInvitation, acceptInvitation, revokeInvitation
                          — reminders.ts: QStash handlers for day-3/day-14
  notifications/
    dispatch.ts           — dispatch()
    email-queue.ts        — QStash email sender (retry + log)
    templates/            — email HTML templates per type
  brand/                  — see platform-brand-governance skill
  types.ts                — shared platform TypeScript types
```

## Common pitfalls

- **Don't read company_id from request body.** Route params + auth session only.
- **Don't skip requireCompanyContext.** Every company-scoped route needs it.
- **Don't use checkAdminAccess for customer routes.** Different gate entirely.
- **Don't use console.log.** `lib/logger.ts` only — audit:static will catch it.
- **Don't import @sendgrid/mail directly.** dispatch() only.
- **Don't hard-delete operator-visible entities.** Soft delete with `deleted_at`.
- **Don't skip version_lock on mutations.** Return 409 on conflict.
- **Don't create platform_users directly.** Only created on invitation acceptance.
- **Don't put canDo checks inside lib/platform/ layer functions.** Route boundaries only.
- **Don't insert notifications outside the originating transaction.** They must be atomic.
