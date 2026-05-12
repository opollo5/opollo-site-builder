# Direct OAuth investigation — overnight build 2026-05-12

**Goal A**: switch `createPortalLink` → `socialAccountConnect` for a single-popup, platform-direct OAuth flow.

**TL;DR — VERDICT: V_GREEN (effectively).** The codebase has **already** been on `socialAccountConnect` since BSP-6-CUSTOMER (PR #840-ish). `socialAccountCreatePortalLink` is not invoked from any production path. The popup goes straight to the platform authorize screen (facebook.com / twitter.com / linkedin.com), with bundle.social only intermediating the OAuth callback (an invisible 302, not a portal page).

Goal A is therefore satisfied without code change. Goal B (tile restyle) is the actual work this PR ships.

---

## P0.1 — SDK introspection

From `node_modules/bundlesocial/dist/index.d.ts`:

### Direct OAuth — `socialAccountConnect`

```ts
socialAccountConnect(data?: SocialAccountConnectData): CancelablePromise<SocialAccountConnectResponse>;

type SocialAccountConnectData = {
  requestBody?: {
    type: 'TIKTOK' | 'YOUTUBE' | 'INSTAGRAM' | 'FACEBOOK' | 'TWITTER' | 'THREADS' |
          'LINKEDIN' | 'PINTEREST' | 'REDDIT' | 'MASTODON' | 'DISCORD' | 'SLACK' |
          'BLUESKY' | 'GOOGLE_BUSINESS';
    teamId: string;
    redirectUrl: string;
    serverUrl?: string;                  // Mastodon / Bluesky only
    disableAutoLogin?: boolean;
    forceBrowserOAuth?: boolean;         // Instagram mobile workaround
    instagramConnectionMethod?: 'FACEBOOK' | 'INSTAGRAM';
    withBusinessScope?: boolean;         // FB/IG only
  };
};

type SocialAccountConnectResponse = { url: string };
```

### Hosted portal — `socialAccountCreatePortalLink` (NOT used in prod)

Same `{ url }` response shape but takes `socialAccountTypes: Array<...>` (multi-platform) plus portal-branding params (logoUrl, hidePoweredBy, language, etc.). Replaced by direct-OAuth months ago.

### Other socialAccount methods inventoried

`socialAccountDisconnect` · `socialAccountSetChannel` · `socialAccountUnsetChannel` · `socialAccountRefreshChannels` · `socialAccountGetByType` · `socialAccountConnectionCheck` · `socialAccountProfileRefresh` · `socialAccountCopy` · `socialAccountGetAccountsToDelete`. No additional `*OAuth*`, `*Initiate*`, `*directConnect*` variants exist.

---

## P0.2 — Live probe

Against `teamId=2960f6ea-…` (Opollo), `redirectUrl=https://opollo-site-builder.vercel.app/api/platform/social/connections/callback?company_id=…&popup=1`, `disableAutoLogin=true`:

| Platform | Result | URL host | redirect_uri (in URL params) |
|---|---|---|---|
| `LINKEDIN` | **400** `This team already has a Linkedin account connected. Please disconnect it first.` (expected — pending row 65beb232 occupies the slot) | n/a | n/a |
| `FACEBOOK` | **200** | `www.facebook.com` | `https://api.bundle.social/api/v1/private/integrations/facebook/callback` |
| `TWITTER` | **200** | `api.twitter.com` | (uses `oauth_token` — OAuth 1.0a, no `redirect_uri` in URL) |
| `INSTAGRAM` | **200** | `www.facebook.com` | `https://api.bundle.social/api/v1/private/integrations/instagram/callback` |

For all 200s: `host` is the platform-owned authorize screen. The user opens the popup and sees Facebook / Twitter / LinkedIn directly — no bundle.social-branded portal page.

`redirect_uri` is bundle.social's callback. bundle.social receives the OAuth code, exchanges for a token, processes the account on their side, then redirects to **our** `redirectUrl` (the value we passed in `requestBody.redirectUrl`). The bundle.social hop happens as an HTTP 302 within the popup — no UI surface.

---

## P0.3 — URL inspection (no browser open)

- `host = www.facebook.com` / `api.twitter.com` — platform-owned, not bundle.social. ✓
- `redirect_uri` (where the platform sends the user after auth) = bundle.social. bundle.social then 302s to our callback URL.
- User-visible authorize screen: platform-direct.
- Visible bundle.social branding: none on the way in; possible flash of `api.bundle.social/...` on the way back (mostly imperceptible — it's a 302).

**Goal A "single-popup, no portal hop" criterion met.** Steven accepted "bundle.social brand on authorize screen" as fallback; we don't even hit that — the actual authorize screen is platform-direct.

---

## P0.4 — Callback param probe

Re-checked the callback contract docs at https://info.bundle.social/api-reference/connect-social-accounts.

Both flows (hosted portal + direct connect) terminate at our `redirectUrl` with the same query-param contract:

- `?<platform>-callback=1` — success
- `?<platform>-not-enough-permissions=1` — user declined a required scope
- `?<platform>-not-enough-followers=1` — TikTok-only minimum-follower failure
- `?error=...` — generic error string

PR #877 already handles all of these in `app/api/platform/social/connections/callback/route.ts`, including the unknown-params fallback. No callback handler change needed.

---

## P0.5 — Verdict

**V_GREEN** — direct OAuth works, redirect contract matches, callback handler already wired. Customer and admin connect routes already call `socialAccountConnect` via `initiateProfileConnect`. No OAuth code change required.

**Phase 2 reduces to**: optional cosmetic cleanup (rename / remove unused `createPortalLink` mocks in test files and the probe script). Production code paths already migrated.

---

## Call-site audit

`grep socialAccountCreatePortalLink|createPortalLink` returns 6 files; **zero** of them are production call sites:

| File | Why it references the method |
|---|---|
| `lib/__tests__/social-connections-bundlesocial.test.ts` | `vi.fn()` mock at top-of-file; never invoked by the sync code path under test. |
| `lib/__tests__/social-identity-cross-tenant.test.ts` | Same — mock stub. |
| `lib/platform/social/profiles/connect.ts` | Comment block: "Uses bundle.social's socialAccount.socialAccountConnect endpoint (NOT socialAccountCreatePortalLink — that's the hosted-portal flow)." |
| `scripts/probes/bundle-social.ts` | Probe script — calls it for connectivity smoke. Optional cleanup. |
| `docs/architecture/BUNDLE_SOCIAL_THEMING.md` | Doc — describes the legacy portal flow. |
| `docs/test-coverage-target.md` | Doc — historical reference. |

Production paths (`app/api/platform/social/connections/connect/route.ts` and `app/api/admin/companies/[id]/social-profiles/[profileId]/connect/route.ts`) both call `initiateProfileConnect` from `lib/platform/social/profiles/connect.ts:158`, which uses `socialAccountConnect`.

---

## What this PR actually does

- **Phase 1 (Goal B)**: tile-grid restyle of the Connect lightbox in `SocialConnectionsList.tsx` and `AdminProfileConnectionsList.tsx`. This is the substantive change.
- **Phase 2 (Goal A)**: documentation-only — Goal A is already shipped. Stale createPortalLink test mocks may be cleaned up; nothing in production changes.
- **Phase 3**: data snapshot in PR description.
- **Phase 4**: typecheck / lint / unit / component / build; open PR.
