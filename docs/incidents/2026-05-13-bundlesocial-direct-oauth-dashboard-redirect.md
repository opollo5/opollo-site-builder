# bundle.social direct OAuth — popup lands on dashboard (2026-05-13)

## Summary

After any platform OAuth completes, bundle.social redirects the popup to
`bundle.social/dashboard/general/social-accounts` instead of our
`redirectUrl`. Our `/callback` endpoint was never called. `social_connections`
had 0 rows despite connections existing on bundle.social's side (team
`2960f6ea` had a LinkedIn account `4b3b1448`).

## Investigation steps (per CLAUDE.md live diagnostic protocol)

### P0 — env vars (step 0)

`BUNDLE_SOCIAL_API` and `BUNDLE_SOCIAL_TEAMID` confirmed set in production
via `vercel env ls production`.

### P1 — regression test (step 1)

`npm run test:unit -- tests/regressions/no-portal-link-in-production.test.ts`
→ PASS. Confirmed `socialAccountCreatePortalLink` is not called from any
production path.

### P2 — deployed bundle matches source (step 2)

PR #883 deployed commit `47cc053b`, confirmed via `vercel inspect`.

### P3 — live probe of `socialAccountConnect` (step 3 / I4)

Against teams with free slots. Results:

| Platform | `disableAutoLogin` | URL host | Key params |
|---|---|---|---|
| LINKEDIN (with) | true | `www.linkedin.com` | `/oauth/v2/authorization`, PKCE, same scopes |
| LINKEDIN (without) | false | `www.linkedin.com` | Identical — flag has no effect on LinkedIn |
| TWITTER | true | `api.twitter.com` | OAuth 1.0a |
| FACEBOOK | true | `www.facebook.com` | `auth_type=rerequest,reauthenticate` |
| FACEBOOK | false | `www.facebook.com` | `auth_type=rerequest` |

**Finding 1**: `disableAutoLogin: true` has **no effect on LinkedIn**. The
LinkedIn OAuth URL is identical regardless of the flag. bundle.social maps
it to `auth_type=rerequest,reauthenticate` for Facebook/Instagram but ignores
it for LinkedIn. LinkedIn always shows a login prompt (platform design, not our bug).

**Finding 2**: `redirect_uri` in ALL platform OAuth URLs is
`https://api.bundle.social/api/v1/private/integrations/<platform>/callback`.
Our `redirectUrl` is not in the OAuth URL — it is stored server-side on
bundle.social's system, keyed by the `state` parameter.

### P4 — full network trace (step 4)

`social_connections` table: `0 rows`. `vercel logs` showed no hits to
`/api/platform/social/connections/callback` in recent history.

**Conclusion**: bundle.social's callback endpoint
(`api.bundle.social/api/v1/private/integrations/<platform>/callback`) does NOT
redirect the browser to our `redirectUrl` after processing the OAuth code.
It redirects to `bundle.social/dashboard/general/social-accounts`.

The `redirectUrl` parameter in `socialAccountConnect` is either:
- Used as a server-side webhook (POST notification), OR
- Only used in the `socialAccountCreatePortalLink` flow (which routes through
  bundle.social's portal page from the start), not in the direct OAuth flow.

### P5 — portal link test (step 5)

`socialAccountCreatePortalLink` against team `2960f6ea` returns
`bundle.social/connect?token=...` with a valid JWT — meaning our domain IS
in the redirect whitelist for the portal flow. The direct OAuth flow uses a
different (or no) whitelist, which is why portal redirects work but direct
OAuth does not.

### P6 — verdict

**NOT a third-party bug** (incomplete documentation on our side — the PR #880
investigation only verified step 1 of the direct OAuth flow, not the full
redirect chain).

**Root cause in our code**: We assumed `socialAccountConnect`'s `redirectUrl`
would be honoured as a browser redirect. It is not. The popup always lands on
bundle.social's dashboard after OAuth completes.

## Fix (PR #884)

When the popup closes (user manually closes bundle.social's dashboard, or
window.close() fires via postMessage from our callback on the happy path),
explicitly POST `/api/platform/social/connections/sync`. If sync reports
`inserted > 0`, auto-open the `ChannelPickerModal` for any new
`pending_identity` connections.

This is robust to both paths:
- **Happy path** (our callback is called): postMessage handler runs first,
  clears the poll, opens picker directly. Sync-on-close doesn't run.
- **Dashboard path** (bundle.social redirects to their UI): user closes popup
  → sync-on-close runs → sync inserts the row → auto-picker opens.

## Issue 1: LinkedIn forced login (document only)

`disableAutoLogin: true` has no effect on LinkedIn. LinkedIn always shows a
fresh login/authorize screen (standard OAuth 2.0 PKCE, no silent re-auth).
This is platform behavior — not fixable on our side. `disableAutoLogin` is
still useful for Facebook/Instagram where it adds `auth_type=reauthenticate`.

## Files changed

- `components/SocialConnectionsList.tsx` — sync-on-popup-close + auto-picker
- `components/AdminProfileConnectionsList.tsx` — same
- `tests/regressions/popup-close-triggers-sync.test.tsx` — regression test
