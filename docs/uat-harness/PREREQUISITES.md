# UAT Harness — Prerequisites

**Status:** Staging is at State A (8/12 — 4 external actions remain).  
**Blocker for UAT harness build:** BLOCKED-1 must be resolved first (see `docs/staging/BLOCKED.md`).

---

## What "State A" means for the UAT harness

The UAT harness is a set of routes and test utilities that let automated sessions
authenticate as the ghost user (`uat-bot@staging.opollo.com`) and exercise staging
features without touching production data.

The harness is **only safe to build after BLOCKED-1 is resolved.** Until then,
server-side routes on the staging branch still write to production Supabase
(`sazapxgmrdaewrkwoxby`). A UAT session that creates posts, connections, or users
before BLOCKED-1 is fixed will pollute live production data.

---

## External actions Steven must complete first

These are documented in full at `docs/staging/BLOCKED.md`. Summary:

| # | Action | Where |
|---|---|---|
| BLOCKED-1 | Add branch-specific `SUPABASE_URL` = `https://bjiiqnetaxoibhcaukqm.supabase.co` for the `staging` branch in Vercel | Vercel dashboard → Project → Settings → Environment Variables → Add Variable → Git Branch = `staging` |
| BLOCKED-2 | Fix `NEXT_PUBLIC_SUPABASE_URL` typo (current value starts with `ttps://` — missing `h`) | Same Vercel env vars panel |
| BLOCKED-3 | Add GitHub Actions secrets: `STAGING_SUPABASE_PROJECT_REF=bjiiqnetaxoibhcaukqm`, `STAGING_SUPABASE_DB_PASSWORD` | GitHub repo → Settings → Secrets and variables → Actions |
| BLOCKED-4 | Add `STAGING_UAT_PASSWORD` (any password — used to authenticate `uat-bot@staging.opollo.com`) | Same GitHub secrets panel |

---

## Staging environment facts

| Item | Value |
|---|---|
| Supabase project ref | `bjiiqnetaxoibhcaukqm` |
| Staging URL | `https://opollo-site-builder-git-staging-opollo5.vercel.app` |
| Verification endpoint | `GET /api/debug/env-check` (returns 404 on production) |
| Ghost user email | `uat-bot@staging.opollo.com` |
| Ghost user auth UUID | `83d5acfa-897e-450b-8dd5-468edfe57c93` |
| UAT company slug | `uat-staging` |
| UAT company ID | `ec59a3cd-ce37-477c-a3f5-d5a37a6b51bb` |

---

## Env vars the UAT harness will need

The UAT harness routes (`/api/uat/*`) will need these available at runtime
on the staging deployment:

| Variable | Value | Source |
|---|---|---|
| `SUPABASE_URL` | `https://bjiiqnetaxoibhcaukqm.supabase.co` | After BLOCKED-1 is fixed |
| `SUPABASE_SERVICE_ROLE_KEY` | staging service-role key | Already set in Vercel (Steven confirmed) |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://bjiiqnetaxoibhcaukqm.supabase.co` | After BLOCKED-2 is fixed |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | staging anon key | Already set in Vercel |
| `STAGING_UAT_PASSWORD` | (Steven sets this) | After BLOCKED-4 |
| `APP_ENV` | `staging` | Already set |

---

## Seed data state at build time

The staging Supabase contains these rows (verified 2026-05-24):

| Table | Count | Notes |
|---|---|---|
| `platform_companies` | 2 | Opollo internal + `UAT Test Company` (slug: `uat-staging`) |
| `platform_users` | 1 | `uat-bot@staging.opollo.com` (admin of UAT company) |
| `social_connections` | 3 | LinkedIn (active), Facebook (expired), X/Twitter (pending) |
| `social_post_drafts` | 5 | draft, scheduled ×2, publishing, published |
| `image_library` | 10 | Mixed stock images with embeddings |
| `social_post_analytics_snapshots` | 1 | For the published draft |

The seed script is idempotent — re-running `npm run seed:staging` resets the UAT
data to this baseline state without affecting other companies.

---

## Sign-in approaches for the UAT harness

Two options for authenticating the ghost user in automated sessions:

### Option A — Password auth (simplest, requires BLOCKED-4)

```typescript
// /api/uat/sign-in — server route, returns a session cookie
const { data, error } = await supabase.auth.signInWithPassword({
  email: "uat-bot@staging.opollo.com",
  password: process.env.STAGING_UAT_PASSWORD!,
});
```

The route must be guarded to return 404/403 unless `APP_ENV === "staging"`.

### Option B — Service-role impersonation (no password needed)

```typescript
// Use admin client to generate a magic link or set a session directly
const adminClient = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false } });
const { data } = await adminClient.auth.admin.generateLink({
  type: "magiclink",
  email: "uat-bot@staging.opollo.com",
});
// Return the link; Playwright follows it to establish a session
```

Option B avoids BLOCKED-4 but is slightly more complex.
Recommendation: implement Option A first (simpler), fall back to Option B if BLOCKED-4 remains unresolved.

---

## Verification before starting the UAT harness build

Run these checks after BLOCKED-1 and BLOCKED-2 are fixed:

```bash
# 1. Confirm staging env-check shows staging Supabase
curl https://opollo-site-builder-git-staging-opollo5.vercel.app/api/debug/env-check
# Expected: supabase_url contains "bjiiqnetaxoibhcaukqm"

# 2. Confirm production guard still holds
curl https://opollo-site-builder.vercel.app/api/debug/env-check
# Expected: HTTP 404

# 3. Confirm staging Supabase has UAT user
curl -sf "https://bjiiqnetaxoibhcaukqm.supabase.co/rest/v1/platform_users?select=count" \
  -H "apikey: <staging-service-key>" \
  -H "Authorization: Bearer <staging-service-key>" \
  -H "Prefer: count=exact" -I
# Expected: Content-Range: */1 (not 0, not production user count)
```

Once all three pass, staging is fully isolated and the UAT harness session can begin.

---

## UAT harness session scope (next session)

- Build `/api/uat/sign-in` route (staging-only, service-role bypass)
- Build `/api/uat/reset` route (wipes and re-seeds UAT data to baseline)
- Wire Playwright config to use staging URL + UAT credentials
- Write one smoke E2E that signs in as UAT ghost user and verifies the social composer loads
