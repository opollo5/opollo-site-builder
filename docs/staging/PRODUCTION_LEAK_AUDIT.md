# Production Leak Audit — Staging `SUPABASE_URL` misconfiguration

**Date:** 2026-05-24  
**Discovered by:** UAT harness run returning `"Failed to look up user: Invalid API key"`  
**Root cause:** Vercel staging preview env has `SUPABASE_URL` = `https://sazapxgmrdaewrkwoxby.supabase.co` (production) while `NEXT_PUBLIC_SUPABASE_URL` = `https://bjiiqnetaxoibhcaukqm.supabase.co` (staging).

## Fix required (Steven manual action)

In Vercel Dashboard → Project `opollo-site-builder` → Settings → Environment Variables → Preview (branch: staging):

```
SUPABASE_URL = https://bjiiqnetaxoibhcaukqm.supabase.co
```

This unblocks `getServiceRoleClient()` on staging, fixes the CSP `connect-src` header, and eliminates all leaks listed below.

---

## Affected code paths on staging deployment

### SEVERITY: CRITICAL — All `getServiceRoleClient()` call sites (~100+ routes)

`lib/supabase.ts:getServiceRoleClient()` reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. On staging, this currently points at production. The service role key mismatch causes HTTP 500 errors, so writes are **failing** (not silently succeeding) — but the intent-leak is still present.

After `SUPABASE_URL` is fixed to staging AND `SUPABASE_SERVICE_ROLE_KEY` is confirmed to be the staging service role key, all calls will correctly target staging.

**API routes using `getServiceRoleClient()` (exercised by UAT specs or normal staging use):**

| Route | Operation | Staging-exercised? |
|---|---|---|
| `app/api/auth/forgot-password/route.ts` | Auth admin | Yes — UAT auth spec |
| `app/api/auth/resend-challenge/route.ts` | Auth admin | Yes — UAT auth spec |
| `app/api/admin/users/invite/route.ts` | User invite | Yes — UAT admin spec |
| `app/api/admin/users/list/route.ts` | User list | Yes — UAT admin spec |
| `app/api/platform/social/drafts/route.ts` | Draft create/read | Yes — UAT composer spec |
| `app/api/platform/social/drafts/[id]/route.ts` | Draft update/delete | Yes — UAT composer spec |
| `app/api/platform/social/media/image-library/route.ts` | Image library | Yes — UAT media-library spec |
| `app/api/platform/social/connections/callback/route.ts` | OAuth callback | Yes — UAT connections spec |
| `app/api/platform/companies/list/route.ts` | Company list | Yes — every page load |
| `app/api/internal/cron/publish-due/route.ts` | Publish scheduled posts | Yes — cron fires on staging |
| `app/api/cron/process-brief-runner/route.ts` | Brief generation | Yes — cron fires on staging |
| `app/api/insights/recommendations/route.ts` | Insights reads | Yes — UAT insights spec |
| All other routes (90+) | Various admin + platform | Staging-accessible |

**Current status:** All `getServiceRoleClient()` calls return 500 on staging because `SUPABASE_SERVICE_ROLE_KEY` (`sb_secret__V-zkzh4g2_...`) does not match the production URL. No silent writes to production are happening. Data integrity is intact.

---

### SEVERITY: HIGH — `app/api/account/change-password/route.ts:43`

```typescript
const url = process.env.SUPABASE_URL;   // production on staging
const anonKey = process.env.SUPABASE_ANON_KEY;
const probe = createClient(url, anonKey, { auth: { persistSession: false } });
```

Constructs an ephemeral Supabase client using `SUPABASE_URL` (production) + `SUPABASE_ANON_KEY` (likely staging, since `SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` may differ). This is a read-only credential verification call (checks "do these credentials validate?"). On staging it will fail silently (auth probe against wrong project), causing change-password to always report failure.

**Exercised on staging:** Yes — any staging user trying to change their password.

---

### SEVERITY: MEDIUM — `lib/security-headers.ts:83`

```typescript
const supabaseOrigin = process.env.SUPABASE_URL ?? "";
// Used in connect-src of report-only CSP header
```

The CSP `connect-src` header on staging lists the production Supabase origin (`sazapxgmrdaewrkwoxby.supabase.co`) instead of the staging one (`bjiiqnetaxoibhcaukqm.supabase.co`). This is report-only (not blocking) but means CSP violation reports would reference the wrong origin and client-side fetch calls to staging Supabase would appear in the violation log.

**Exercised on staging:** Yes — every page response includes this header.

---

### SEVERITY: LOW — `app/api/debug/env-check/route.ts:33`

```typescript
process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? undefined;
```

Reads `SUPABASE_URL` for diagnostic display only. No DB connection made. Would show the wrong (production) URL in the debug output on staging.

---

### NOT AFFECTED — `app/api/uat/sign-in/route.ts` (fixed 2026-05-24)

Fixed to use `NEXT_PUBLIC_SUPABASE_URL ?? SUPABASE_URL` so the admin client correctly targets staging. This is the fix that unblocked the UAT harness from its initial 500 errors.

---

## Scripts (not deployed, not affected)

Scripts in `scripts/` and `lib/scripts/` read `SUPABASE_URL` but run as CLI tools with explicit env injection. Not affected by the Vercel env misconfiguration.

## Tests (not deployed, not affected)

`lib/__tests__/` and `e2e/` inject `SUPABASE_URL` via CI env vars (pointing at the correct local or staging Supabase). Not affected.

---

## Recommended fix sequence

1. **Steven:** Set `SUPABASE_URL = https://bjiiqnetaxoibhcaukqm.supabase.co` in Vercel staging preview env
2. **Steven:** Confirm `SUPABASE_SERVICE_ROLE_KEY` in Vercel staging preview is the staging project's service role key (not production's)
3. **Redeploy staging** (push any commit to `staging` branch) so the new env vars take effect
4. Re-run UAT harness — the "Invalid API key" and change-password failures should resolve
