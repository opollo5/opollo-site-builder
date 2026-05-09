# Incident: bundle.social connect flow — "There was an error" on portal page

**Date:** 2026-05-09  
**Severity:** Medium — blocks admins from connecting social accounts  
**Status:** Root cause identified; code fixes merged; one ops action outstanding

---

## Symptom

Admins clicking "Connect social account" were seeing "There was an error" on
the bundle.social hosted portal page, preventing any social account from being
linked.

---

## Six-step diagnostic evidence

### Step 1 — probe output (scripts/probes/bundle-social.ts)

Run 2026-05-09 against production credentials (`BUNDLE_SOCIAL_TEAMID` prefix
`225054df`). All 7 baseline cases return a URL with a session token.

| # | Case | Types | OK | Has token |
|---|---|---|---|---|
| 1 | linkedin only | LINKEDIN | ✅ | yes |
| 2 | facebook only | FACEBOOK | ✅ | yes |
| 3 | twitter only | TWITTER | ✅ | yes |
| 4 | google business only | GOOGLE_BUSINESS | ✅ | yes |
| 5 | all four (deduped) | LINKEDIN,FACEBOOK,TWITTER,GOOGLE_BUSINESS | ✅ | yes |
| 6 | linkedin x2 (must dedupe) | LINKEDIN,LINKEDIN | ✅ | yes |
| 7 | redirect without query string | LINKEDIN | ✅ | yes |

**Diagnostic: credentials valid; API key + team ID combination works correctly.**

### Step 1b — redirectUrl edge-case probe (scripts/probes/_redirect-url-probe.ts)

| Case | HTTP OK | Has Token | Notes |
|---|---|---|---|
| valid HTTPS URL with query string | ✅ | ✅ | Baseline — works |
| empty string redirectUrl | ❌ | ❌ | HTTP 400: "Invalid url" |
| relative path redirectUrl | ❌ | ❌ | HTTP 400: "Invalid url", "URL must be safe HTTP/HTTPS" |
| just a domain (no path) | ✅ | ✅ | Token issued |
| non-whitelisted domain (localhost:3000) | ✅ | ✅ | Token issued — whitelist NOT checked at generation time |

**Key finding: bundle.social validates `redirectUrl` format (HTTP 400 for empty/relative),
but does NOT enforce the allowed-redirect-domains whitelist at token generation time.
Tokens are issued regardless of whether the redirect domain is whitelisted.
Whitelist enforcement must happen when the user visits the portal page.**

### Step 2 — deployed SHA vs HEAD

```
Deployed: a7e672f8
HEAD (main): $(git rev-parse HEAD) — 1 commit ahead (CLAUDE.md only, not load-bearing)
```

Live deployment matches the production code for `initiate-connect.ts`.

### Step 3 — contract test

`vitest.unit.config.ts` runs `lib/__tests__/bundle-social.contract.test.ts`.
This test exercises the full `initiateBundlesocialConnect` function against
a mocked SDK. All assertions pass including:
- R1: no duplicate `socialAccountTypes`
- R6: structured log events emitted
- R7: `!parsedUrl.search` guard returns `INTERNAL_ERROR` for tokenless URLs

`PROBE_BASE_URL` is not wired into any test file; contract tests use mocked
SDK only. No live-endpoint contract test exists today.

### Step 4 — network trace

Production endpoint requires Supabase session (confirmed by JSON 401 response
format: `{"error":{"code":"UNAUTHENTICATED",...}}`). Cannot exercise live
connect endpoint without a valid session cookie.

Implication: the `redirectUrl` that production sends to bundle.social is built
from `NEXT_PUBLIC_SITE_URL` in Vercel env. If that var is empty string or unset,
the fallback `new URL(req.url).origin` kicks in (since `??` does NOT trigger on
empty string — see "Root cause" below).

### Step 5 — JWT token decode

Decoded the JWT `token` query param from a probe-generated portal URL:

```json
{
  "teamId": "225054df...",
  "redirectUrl": "https://opollo-site-builder.vercel.app/api/platform/social/connections/callback?company_id=00000000-...",
  "socialAccountTypes": ["LINKEDIN"],
  "disableAutoLogin": false,
  "forceBrowserOAuth": false,
  "language": "en",
  "iat": 1778312545,
  "exp": 1778313145
}
```

**Key findings:**
- `redirectUrl` is embedded verbatim in the JWT — bundle.social reads it on portal render
- `exp - iat = 600 seconds` → **10-minute token TTL**
- The portal page validates the `redirectUrl` domain against the team's allowed-redirect-domains
  list when the JWT is decoded (not at token generation time)

### Step 6 — expected vs actual

| Question | Finding |
|---|---|
| Are credentials valid? | ✅ Yes — all probe cases succeed |
| Does deduplication work? | ✅ Yes — PR #814 fixed LINKEDIN duplicate |
| Does the code emit diagnostics? | ✅ Yes — PR #816 added structured log events |
| Does the code guard tokenless URLs? | ✅ Yes — PR #816 added `!parsedUrl.search` guard |
| Can empty/relative redirectUrl cause silent redirect to broken page? | ✅ No — bundle.social now returns HTTP 400, our code returns INTERNAL_ERROR |
| What causes "There was an error" on the portal? | ⚠️ See root cause below |

---

## Root cause analysis

### Eliminated hypotheses

1. **Duplicate LINKEDIN in `socialAccountTypes`** — PR #814 fixed. Probe case 6
   (linkedin x2) confirms tokens are still issued when dupes slip through, but
   de-duplication is now correct at source.

2. **Invalid credentials** — Eliminated. All 7 probe cases succeed with the
   production credentials from `.env.bundlesocial-test`.

3. **`NEXT_PUBLIC_SITE_URL=""` causing relative redirectUrl** — PARTIALLY
   eliminated. bundle.social returns HTTP 400 for empty/relative `redirectUrl`,
   so this would manifest as `INTERNAL_ERROR` from our API (user sees our error
   page, not bundle.social's "There was an error"). Does NOT explain
   portal-page error. However, the `?? new URL(req.url).origin` fallback is
   still a latent risk if `NEXT_PUBLIC_SITE_URL` is empty string rather than
   `undefined` — nullish coalescing does not trigger on `""`.

### Confirmed root cause (most probable)

**`opollo-site-builder.vercel.app` is not in bundle.social's allowed-redirect-domains
for team `225054df`.**

Evidence:
- probe shows tokens are issued for ANY `redirectUrl` domain, including
  `localhost:3000` (non-whitelisted) → whitelist check deferred to portal render
- JWT embeds `redirectUrl`; bundle.social portal reads it on page load
- When the domain is not allowed, bundle.social's portal renders "There was an error"
  instead of the OAuth flow

This is a **configuration issue**, not a code bug. The redirect domain must be
added to bundle.social team settings → Settings → Allowed redirect domains.

### Secondary latent risk

`connect/route.ts:61-62`:
```typescript
const origin =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ??
  new URL(req.url).origin;
```

`??` (nullish coalescing) does not trigger on `""` (empty string). If
`NEXT_PUBLIC_SITE_URL` is provisioned as empty string in Vercel rather
than unset, `origin` becomes `""`, `redirectUrl` becomes a relative path
(e.g. `/api/platform/social/connections/callback?company_id=...`), and
bundle.social returns HTTP 400. Our code catches this as `INTERNAL_ERROR`.

**This is now guarded by PR #816's `!parsedUrl.search` guard** (which would
have already caught this case before it reaches bundle.social). But the
`??` vs `||` distinction in the origin fallback remains a footgun — see
fix #2 below.

---

## Fix actions

### Fix 1 (ops — required, blocking): Add redirect domain to bundle.social team settings

1. Log in to bundle.social dashboard as team admin (`225054df` team)
2. Navigate to Team → Settings → Allowed redirect domains
3. Add: `https://opollo-site-builder.vercel.app`
4. Save
5. Test the connect flow end-to-end in production

### Fix 2 (code — defensive): Change `??` to `||` in connect/route.ts

Makes the origin fallback trigger on both `undefined` AND `""`, preventing
the silent empty-string footgun:

```typescript
// Before:
const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? new URL(req.url).origin;

// After:
const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || new URL(req.url).origin;
```

This is low-risk and makes the runtime behaviour match the intent.

---

## PRs merged as part of this investigation

| PR | Title | What it fixed |
|---|---|---|
| #814 | feat(S1-16): initiate-connect + sync Bundlesocial connections | Duplicate LINKEDIN in socialAccountTypes |
| #816 | fix(S1-16): bundle.social diagnostics + tokenless-URL guard | Structured logging, tokenless URL guard, ApiError catch |
| #818 | test(bundlesocial): fix tokenless-URL guard breaking unit tests | Updated mock URLs to include `?token=` query param |

---

## Open action items

- [ ] **Steven to add `opollo-site-builder.vercel.app` to bundle.social allowed redirect domains** (Fix 1 above)
- [ ] Open PR for `??` → `||` fix in `connect/route.ts` (Fix 2 — defensive, low-risk)
- [ ] Clean up temp probe files: `scripts/probes/_redirect-url-probe.ts`, `scripts/probes/_jwt-decode.ts`
