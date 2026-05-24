# Production Leak Audit — Staging anon-key mismatch

**Date:** 2026-05-24  
**Revised:** 2026-05-24 (initial diagnosis was wrong — see "Misdiagnosis walkback" below)

---

## Misdiagnosis walkback

The initial version of this document claimed `SUPABASE_URL` in the Vercel staging preview env was pointing at production. **That was wrong.** Steven verified visually:

- Preview env = `bjiiqnetaxoibhcaukqm.supabase.co` (staging) ✅
- Production / Development env = `sazapxgmrdaewrkwoxby.supabase.co` ✅

The `vercel env pull --environment preview --git-branch staging` output that triggered the misdiagnosis was either stale or read wrong. A fresh pull confirms `SUPABASE_URL = https://bjiiqnetaxoibhcaukqm.supabase.co` for the staging preview.

**Walkback:** The `getServiceRoleClient()` audit table in the previous version of this doc is now moot. The 100+ deployed routes using `getServiceRoleClient()` are NOT talking to production from staging. Disregard that section.

---

## Actual finding — `SUPABASE_ANON_KEY` mismatch

The Vercel staging preview env has **two different anon keys** for the same Supabase URL:

| Env var | Value | Read by |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_aRfW3fJx9LngWIfJJN7XHA_JzkGyqOQ` | Client-side + my updated UAT sign-in route |
| `SUPABASE_ANON_KEY` | `sb_publishable_bSgr6ZFyqHObdcjF27Qzjg_OCytNRHL` | Middleware + every server-side `createServerClient` call |

Both target `https://bjiiqnetaxoibhcaukqm.supabase.co`. One of these keys is invalid for the staging project (most likely `SUPABASE_ANON_KEY` is a stale or production-project key copied across).

### Failure mode the mismatch produces

1. UAT sign-in route sets a session cookie successfully (it uses `NEXT_PUBLIC_SUPABASE_ANON_KEY` → correct staging key → GoTrue accepts it).
2. Browser receives the cookie with valid expiry and sends it on the next request.
3. Middleware calls `supabase.auth.getUser()` using `SUPABASE_ANON_KEY` (wrong key).
4. GoTrue returns "Invalid API key".
5. `middleware.ts:281-286` swallows the error silently:
   ```typescript
   const { data, error } = await supabase.auth.getUser();
   if (error) {
     userId = null;   // ← treats as no session
   }
   ```
6. Middleware redirects to `/login?next=…`.

The previous run's "Invalid API key" error came from the UAT sign-in route's old `getServiceRoleClient()` (now bypassed). The current run's redirect to `/login` is the same root cause expressed through middleware's silent-failure path.

### Network trace evidence

From Playwright trace for the failed `signInAsUatBot succeeds and lands on /company/social` spec:

```
== POST /api/uat/sign-in → 200
   SET: sb-bjiiqnetaxoibhcaukqm-auth-token (Expires=2027, Max-Age=34560000)
== GET /company/social/calendar → 307
   REQ: sb-bjiiqnetaxoibhcaukqm-auth-token=base64-eyJh...   ← cookie present
   HDR: location: /login?next=%2Fcompany%2Fsocial%2Fcalendar
```

The decoded cookie contained a valid JWT for `uat-bot@staging.opollo.com` with `user_id: 83d5acfa-897e-450b-8dd5-468edfe57c93` (the correct ghost user). Token expiry was 1 hour in the future. Project ref `bjiiqnetaxoibhcaukqm` matches `SUPABASE_URL`.

### Real impact (beyond UAT)

Any user who signs in on staging via the normal `/login` page would experience the same silent failure — except the regular sign-in route runs on the server, uses `SUPABASE_ANON_KEY` end-to-end, and gets a hard error from GoTrue at sign-in time (so it never sets a bad cookie). The UAT route currently happens to use `NEXT_PUBLIC_SUPABASE_ANON_KEY` which masks the problem at sign-in but exposes it on the next page load.

So in practice, staging may already be broken for sign-in flows that hit the server-side anon-key path. Worth confirming separately.

---

## Fix required (Steven manual action)

In Vercel Dashboard → Project `opollo-site-builder` → Settings → Environment Variables → Preview (branch: staging):

```
SUPABASE_ANON_KEY = sb_publishable_aRfW3fJx9LngWIfJJN7XHA_JzkGyqOQ
```

(i.e., set it to the same value as `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which is verified to work against the staging project.)

Alternative: verify which of the two keys is actually the staging-project anon key by checking the Supabase Dashboard for `bjiiqnetaxoibhcaukqm` → Settings → API → "anon public" key. Whichever value matches is the correct one; the other should be deleted/replaced.

### After Steven's fix

1. Redeploy staging (push any commit to `staging` branch)
2. Trigger UAT harness manually
3. Expect: 49+ sign-in-dependent specs that were timing out at 45s should now either pass or fail on the actual UI behavior they were written to test
