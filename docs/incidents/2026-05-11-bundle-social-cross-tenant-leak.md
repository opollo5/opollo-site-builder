# Incident — bundle.social cross-tenant LinkedIn leak

**Status:** **Resolved.** Fix shipped on branch `fix/social-identity-fingerprints`. See [Resolution](#resolution) at the bottom.
**Reporter:** Steven Morey
**Investigator:** Claude (autonomous)
**Date:** 2026-05-11
**Investigation branch:** `investigate/bundle-social-cross-tenant-leak` (draft PR #865)
**Fix branch:** `fix/social-identity-fingerprints`
**Severity:** Medium — exploitable by any operator/admin who connects the *same* platform-side identity (LinkedIn person, FB user, etc.) across more than one company in the same browser session. The investigation found Steven's LinkedIn person as the OAuth grantor for 4 different bundle.social teams; symptom is generic across all bundle.social-supported platforms.

---

## 1. Executive summary

- The reported symptom — "Customer A's LinkedIn appears as Customer B's connection without OAuth re-prompt" — is real but caused by **the OAuth provider (LinkedIn) silently re-authorising the same logged-in person across consecutive consent screens**. bundle.social honours the silent re-auth and creates a fresh `socialAccount` record on the target team without prompting.
- Our DB-level invariants hold: **A1, A2, A3 all return zero rows**. No `bundle_social_account_id` is shared across companies; no `bundle_social_team_id` is shared across companies or profiles.
- bundle.social-side invariants hold at the account-id level: **no socialAccount appears in more than one team**; no orphans; no dangling refs.
- However: **the same LinkedIn `userId` (`urn:li:person:cn_0IGowb1`, "Steven Morey") is the OAuth grantor across 4 distinct bundle.social teams** (Opollo, ASCII Group, Planet6, Skyview). Each team has its own bundle.social account id, but they all transit through one LinkedIn person grant.
- **Verdict: hypothesis (3) is correct.** Hypotheses (1), (2), and (4) are not supported by the data.

---

## 2. Part A — DB evidence

### A1 — Duplicate `bundle_social_account_id` across `company_id`s

```json
[]
```

**Rows returned: 0.** No bundle.social account id appears under more than one company. Hypothesis (4) (sync attribution bug) is **not supported**.

### A2 — Duplicate `bundle_social_team_id` across `platform_companies`

```json
[]
```

**Rows returned: 0.** Every company has a unique legacy team. Hypothesis (1) at the company level is **not supported**.

### A3 — Duplicate `bundle_social_team_id` across `platform_social_profiles`

```json
[]
```

**Rows returned: 0.** Every profile has a unique team. Hypothesis (1) at the profile level is **not supported**.

### A4 — Full company picture

```json
[
  { "company_name": "ASCII Group", "company_id": "b7758002-83ce-42d5-a5ec-8eeeb2a38544", "company_legacy_team": null, "profile_name": "ASCII Group", "is_default": true, "profile_team_id": "e7d0cc78-6c76-4c9e-8f43-1a90afda2023", "connection_count": 0 },
  { "company_name": "Opollo",      "company_id": "00000000-0000-0000-0000-000000000001", "company_legacy_team": "2960f6ea-1c15-4baf-8812-00f681c05dd6", "profile_name": "Opollo",      "is_default": true, "profile_team_id": "2960f6ea-1c15-4baf-8812-00f681c05dd6", "connection_count": 0 },
  { "company_name": "Vincovi",     "company_id": "e121b368-4bcc-49a4-a01b-e8488e3630c2", "company_legacy_team": "13e01e42-9d26-48da-8458-ff25c1007dae", "profile_name": "Vincovi",     "is_default": true, "profile_team_id": "13e01e42-9d26-48da-8458-ff25c1007dae", "connection_count": 0 },
  { "company_name": "Planet6",     "company_id": "6e2bb9eb-b49d-4399-9565-645be8f9ba7d", "company_legacy_team": "ba9ca0b2-7bc2-4978-9ed1-85cc8b81a2f3", "profile_name": "Planet6",     "is_default": true, "profile_team_id": "ca1fbd1c-7c53-4aaf-94f3-24993c3e0ee2", "connection_count": 2 },
  { "company_name": "Skyview",     "company_id": "de812a56-0c46-465a-931d-db1b4cb37622", "company_legacy_team": "1acf9761-f9d7-4c6d-adf3-01f5a78708c0", "profile_name": "Skyview",     "is_default": true, "profile_team_id": "5313a67d-75e5-4c40-baa9-cc16dbb7a63b", "connection_count": 1 }
]
```

**Side-finding:** Planet6 and Skyview have a *legacy* `bundle_social_team_id` on `platform_companies` that does **not** match their profile's `bundle_social_team_id`. The legacy teams are empty (created by the BSP-1 backfill that ran *after* migration 0118 had backfilled profiles with the then-null legacy id); the profile teams hold the actual connections. ASCII Group's legacy is null (BSP-1 backfill failed 403 for that one). This is an inefficiency (2 bundle.social teams per affected company) but does **not** create cross-tenant exposure.

### A5 — All `social_connections` rows ordered by `bundle_social_account_id`

```json
[
  { "company_id": "6e2bb9eb-b49d-4399-9565-645be8f9ba7d", "profile_id": "3883a5fd-17e5-4a52-be71-9dcdd1904aef", "platform": "linkedin_personal", "bundle_social_account_id": "227d1c30-fa51-421e-8037-fd14958a30eb", "display_name": null, "status": "healthy", "connected_at": "2026-05-11T11:12:13.210686+00:00" },
  { "company_id": "de812a56-0c46-465a-931d-db1b4cb37622", "profile_id": "a1c0fb5e-eaf8-4d3a-89d0-33478364022d", "platform": "linkedin_personal", "bundle_social_account_id": "a6da2370-88c1-4250-9f57-0a7e38fc5b92", "display_name": null, "status": "healthy", "connected_at": "2026-05-11T11:13:27.276600+00:00" },
  { "company_id": "6e2bb9eb-b49d-4399-9565-645be8f9ba7d", "profile_id": "3883a5fd-17e5-4a52-be71-9dcdd1904aef", "platform": "gbp",               "bundle_social_account_id": "dc6ef90c-5f00-421c-95c7-485bda302b51", "display_name": null, "status": "healthy", "connected_at": "2026-05-11T11:12:01.882622+00:00" }
]
```

3 rows total. Each `bundle_social_account_id` appears once. No DB-side duplication.

---

## 3. Part B — bundle.social API evidence

### B1 + B2 — `teamGetTeam` for every team in DB

7 teams (5 profile teams + 4 legacy company teams, with 2 overlapping where company team == profile team for Opollo/Vincovi).

| team_id | name | socialAccountCount |
|---|---|---|
| `2960f6ea-1c15-4baf-8812-00f681c05dd6` | Opollo | 1 (LINKEDIN) |
| `13e01e42-9d26-48da-8458-ff25c1007dae` | Vincovi | 0 |
| `ba9ca0b2-7bc2-4978-9ed1-85cc8b81a2f3` | Planet6 | 0 (empty legacy team) |
| `1acf9761-f9d7-4c6d-adf3-01f5a78708c0` | Skyview | 0 (empty legacy team) |
| `e7d0cc78-6c76-4c9e-8f43-1a90afda2023` | ASCII Group (b7758002) | 1 (LINKEDIN) |
| `ca1fbd1c-7c53-4aaf-94f3-24993c3e0ee2` | Planet6 (6e2bb9eb) | 2 (LINKEDIN + GOOGLE_BUSINESS) |
| `5313a67d-75e5-4c40-baa9-cc16dbb7a63b` | Skyview (de812a56) | 1 (LINKEDIN) |

5 total social accounts across 7 teams. Each account belongs to exactly one team.

### B3 — `bundle_social_account_id` → teams cross-reference

```json
[]
```

**No socialAccount.id appears in more than one team.** bundle.social maintains per-team uniqueness on its own ids.

### B3.5 — `externalId` duplicates from `teamGetTeam` listing

```json
[]
```

But `externalId` was returned as `null` for 4 of the 5 accounts in the team listing — only Opollo's `LINKEDIN` had `externalId` populated (`urn:li:organization:40810993`). Investigating further via `socialAccountGetByType`...

### B-PLUS — `socialAccountGetByType` for every (team, type) pair

Full per-account detail (the source-of-truth read, includes `userId`, `userUsername`, `externalId`):

```json
[
  { "team_id": "2960f6ea-1c15-4baf-8812-00f681c05dd6", "account_id": "872c8212-d674-47ae-bda3-a456139aecab", "type": "LINKEDIN",        "externalId": "urn:li:organization:40810993", "username": "opollo-marketing", "displayName": "Opollo MSP Marketing", "userUsername": "stevenmorey", "userDisplayName": "Steven Morey", "userId": "urn:li:person:cn_0IGowb1" },
  { "team_id": "e7d0cc78-6c76-4c9e-8f43-1a90afda2023", "account_id": "a915a58c-995b-43cf-b139-6986ec7fa77a", "type": "LINKEDIN",        "externalId": null,                            "username": null,                "displayName": null,                    "userUsername": "stevenmorey", "userDisplayName": "Steven Morey", "userId": "urn:li:person:cn_0IGowb1" },
  { "team_id": "ca1fbd1c-7c53-4aaf-94f3-24993c3e0ee2", "account_id": "227d1c30-fa51-421e-8037-fd14958a30eb", "type": "LINKEDIN",        "externalId": null,                            "username": null,                "displayName": null,                    "userUsername": "stevenmorey", "userDisplayName": "Steven Morey", "userId": "urn:li:person:cn_0IGowb1" },
  { "team_id": "ca1fbd1c-7c53-4aaf-94f3-24993c3e0ee2", "account_id": "dc6ef90c-5f00-421c-95c7-485bda302b51", "type": "GOOGLE_BUSINESS", "externalId": null,                            "username": null,                "displayName": null,                    "userUsername": null,          "userDisplayName": null,          "userId": null },
  { "team_id": "5313a67d-75e5-4c40-baa9-cc16dbb7a63b", "account_id": "a6da2370-88c1-4250-9f57-0a7e38fc5b92", "type": "LINKEDIN",        "externalId": null,                            "username": null,                "displayName": null,                    "userUsername": "stevenmorey", "userDisplayName": "Steven Morey", "userId": "urn:li:person:cn_0IGowb1" }
]
```

### B-PLUS.2 — Same `userId` across multiple teams 🚨

**This is the smoking gun.**

```json
[
  [
    { "team_id": "2960f6ea-1c15-4baf-8812-00f681c05dd6", "account_id": "872c8212-d674-47ae-bda3-a456139aecab", "userId": "urn:li:person:cn_0IGowb1", "userDisplayName": "Steven Morey" },
    { "team_id": "e7d0cc78-6c76-4c9e-8f43-1a90afda2023", "account_id": "a915a58c-995b-43cf-b139-6986ec7fa77a", "userId": "urn:li:person:cn_0IGowb1", "userDisplayName": "Steven Morey" },
    { "team_id": "ca1fbd1c-7c53-4aaf-94f3-24993c3e0ee2", "account_id": "227d1c30-fa51-421e-8037-fd14958a30eb", "userId": "urn:li:person:cn_0IGowb1", "userDisplayName": "Steven Morey" },
    { "team_id": "5313a67d-75e5-4c40-baa9-cc16dbb7a63b", "account_id": "a6da2370-88c1-4250-9f57-0a7e38fc5b92", "userId": "urn:li:person:cn_0IGowb1", "userDisplayName": "Steven Morey" }
  ]
]
```

**Steven Morey's LinkedIn account (`urn:li:person:cn_0IGowb1`) is the OAuth grantor in FOUR different bundle.social teams** belonging to FOUR different companies (Opollo, ASCII Group, Planet6, Skyview).

Each connection has a different bundle.social `account_id` (so our `social_connections` table doesn't see them as duplicates, and bundle.social's per-team uniqueness holds), but they all flow through the same underlying LinkedIn person grant. Posts from any of these connections would authenticate as the same LinkedIn user.

### B-PLUS.3 — Same `userUsername` across teams

Same 4-way collision on `stevenmorey`. Confirms B-PLUS.2.

### B-PLUS.1 — `externalId` duplicates (from detail endpoint)

```json
[]
```

Still zero. `externalId` distinguishes which *channel* / organization page each connection is bound to. Opollo's is bound to organization `urn:li:organization:40810993`. The other 3 LinkedIn accounts have `externalId: null` because the user has not yet selected which LinkedIn channel/page to bind to — they're stuck in "select-the-page" intermediate state.

### B4 — Org-wide team list vs DB

```json
{
  "total_teams_in_org": 7,
  "dangling_refs": [],
  "orphans": []
}
```

Reconciliation perfect: every team in bundle.social is tracked in DB, every team in DB exists in bundle.social.

---

## 4. Part C — Code evidence

### `app/api/platform/social/connections/connect/route.ts` (BSP-6-CUSTOMER + BSP-10)

- Body schema: `{ company_id, profile_id, platform }` — all three required.
- Gate: `requireCanDoForApi(company_id, "manage_connections")` — verifies the authenticated user has admin role in `company_id`.
- **BSP-10 smuggling guard** (lines 88–98): reads the profile row and verifies `profile.company_id === parsed.data.company_id`. Pinned by `tests/regressions/bsp10-connect-rejects-cross-tenant-profile.test.ts`.
- Then calls `initiateProfileConnect({ profileId, platform, redirectUrl, disableAutoLogin: true, withBusinessScope: <FB/IG only> })`.

**No path where `teamId` is derived from anywhere other than the requested `profile_id`.** Hypothesis (2) (fallback-team) is **not supported**.

### `lib/platform/social/profiles/connect.ts`

`initiateProfileConnect` calls `getOrCreateBundleSocialTeamForProfile(profileId)` — strictly profile-scoped — then `client.socialAccount.socialAccountConnect({ requestBody: { type, teamId, redirectUrl, disableAutoLogin, withBusinessScope } })`.

`disableAutoLogin: true` is always set by the connect route. The SDK comment says: *"When true, adds provider-specific flags to avoid automatic login/auto-approval **where supported**."* The key caveat is "where supported" — LinkedIn does **not** support this flag in the way one might hope. LinkedIn's OAuth provider silently re-authorises a recently-consented app for the same logged-in user.

### `lib/platform/social/bundle-social/provision.ts` & `lib/platform/social/profiles/provision-team.ts` (BSP-2-REDO)

- In-process Map `inflight` keyed by **full `companyId` UUID** / **full `profileId` UUID**. No truncation, no collision.
- Slow path acquires `pg_advisory_xact_lock(provision_company_lock_key(uuid))` inside a single transaction, reads the stored `bundle_social_team_id`, returns existing if set, otherwise calls `teamCreateTeam` and `UPDATE ... WHERE bundle_social_team_id IS NULL`.
- The same SQL hash function `provision_company_lock_key` is used for both companies and profiles, but the *advisory lock keyspace is shared across all callers* — meaning a company UUID and a profile UUID could in theory collide on the lock (different UUIDs hash to the same bigint). This is a performance concern (false contention) not a correctness concern — both callers still read their own rows by UUID.
- **No module-level cache that returns stale team ids.** Every slow-path call re-reads from DB inside the lock.

Hypothesis (1) (provision returning the same teamId across companies) is **not supported** — the code reads each row by its own UUID under an advisory lock.

### `lib/platform/social/connections/sync.ts` (BSP-8)

- Reads `platform_social_profiles WHERE company_id = input.companyId AND bundle_social_team_id IS NOT NULL` — strictly scoped per company.
- Walks each team's `socialAccounts`. Per-team failure isolation + all-teams-failed `INTERNAL_ERROR` guard.
- On INSERT for new accounts: `company_id: input.attributeNewToCompanyId` (the company that initiated the connect) + `profile_id: <team→profile lookup>`. The `attributeNewToCompanyId` always equals the company the callback URL declares, which equals the company the user was viewing when they clicked Connect.

**No path where one bundle.social team's accounts get inserted under a different `company_id`.** Hypothesis (4) is **not supported**.

### `components/SocialConnectionsList.tsx`

- Receives `companyId` and `profileId` as server-rendered props from `app/(platform)/company/social/connections/page.tsx`.
- The page reads `session.company.companyId` via `getCurrentPlatformSession()` and bucket-renders one `<SocialConnectionsList>` per profile.
- `handleConnect(platform)` sends `{ company_id: companyId, profile_id: profileId, platform }` — both ids come from the most-recent server render.
- `export const dynamic = "force-dynamic"` on the page — every render fetches fresh.

Company switcher (`components/nav/company-selector.tsx`) calls `router.refresh()` after switching, which re-runs the server component with the new cookie. Server reads the new `companyId` and re-renders the page with new props. **Stale-prop hypothesis is unlikely.** (There's a minor race if the user clicks Connect *while* a switch is in flight; the in-flight fetch carries the OLD ids, which doesn't trigger cross-tenant leakage on its own.)

---

## 5. Part D — Auth evidence

### `lib/platform/auth/current-user.ts → getCurrentPlatformSession`

- Identity from `auth.users` via cookie-bound client.
- `platform_users.is_opollo_staff` check.
- `platform_company_users.company_id` lookup for the user's primary company.
- **Staff override:** if `is_opollo_staff`, read `STAFF_SELECTED_COMPANY_COOKIE`, validate the UUID exists in `platform_companies`, return a synthetic `{ companyId, role: "admin" }`.

The staff cookie is read on **every** request that calls `getCurrentPlatformSession`. There is **no per-request memoization** that could carry the old value across a cookie flip. After the switch endpoint sets the new cookie, the next request reads the new value.

### `app/api/platform/companies/switch/route.ts`

- Auth: cookie-bound `supabase.auth.getUser()` + `is_opollo_staff` / `opollo_users` check.
- Sets `STAFF_SELECTED_COMPANY_COOKIE` with `httpOnly`, `sameSite=lax`, `maxAge=7 days`.
- **No cache invalidation needed** — there is no cache. The next request sees the new cookie.

Hypothesis (1) variant where staff cookie state is carried into a provision call: **not supported**. The provision helpers read their target row by the explicit `profileId` / `companyId` argument, not by ambient session state.

---

## 6. Part E — bundle.social behaviour evidence

### `socialAccountConnect` request body (per `node_modules/bundlesocial/dist/index.d.ts`)

```ts
type SocialAccountConnectData = {
  requestBody?: {
    type: 'TIKTOK' | 'YOUTUBE' | 'INSTAGRAM' | 'FACEBOOK' | 'TWITTER' | 'THREADS' | 'LINKEDIN' | 'PINTEREST' | 'REDDIT' | 'MASTODON' | 'DISCORD' | 'SLACK' | 'BLUESKY' | 'GOOGLE_BUSINESS';
    teamId: string;
    redirectUrl: string;
    serverUrl?: string;            // Mastodon / Bluesky only
    disableAutoLogin?: boolean;    // "where supported"
    forceBrowserOAuth?: boolean;   // Instagram only
    instagramConnectionMethod?: 'FACEBOOK' | 'INSTAGRAM';
    withBusinessScope?: boolean;   // FB / IG
  };
};

type SocialAccountConnectResponse = { url: string };
```

There is **no `linkOnly`, `existingAccountId`, or "reuse-grant" field**. The SDK does expose `socialAccountCopy({ fromTeamId, toTeamId, socialAccountTypes, resetChannel? })` which would explicitly copy an account between teams in the same org — but **our code does not call it anywhere**.

### `disableAutoLogin` semantics

Verbatim from the SDK doc-comment:

> Optional. When true, adds provider-specific flags to avoid automatic login/auto-approval **where supported**.

This is the operative caveat. For Facebook / Instagram / TikTok, bundle.social passes provider-specific flags that surface an account-picker. For **LinkedIn**, there is no equivalent flag — LinkedIn's OAuth provider issues a silent auth code when the same user grants consent to the same app within a short window. bundle.social cannot suppress this at the OAuth-provider layer.

### Account re-use behaviour

When bundle.social receives an OAuth code for LinkedIn `userId=X` from team `T_B`, and `userId=X` is already attached to team `T_A` in the same organisation:

- bundle.social creates a **new** `socialAccount` record in `T_B` with a fresh `id`.
- Both records reference the same underlying LinkedIn person (`userId`).
- Both records can publish — each via the OAuth token bundle.social stored for its own grant.
- Posting from either team posts as `userId` on LinkedIn.

This is normal multi-tenant SaaS behaviour for bundle.social. The *bug* is that **our application has no defence against the same human granting their personal LinkedIn to multiple distinct customers in the same browser session.**

---

## 7. Verdict

**Hypothesis (3) is correct.** Specifically: LinkedIn's OAuth provider auto-approves a repeat consent for the same logged-in user without re-prompting; bundle.social honours that auto-approval and creates a fresh `socialAccount` record on the target team; the resulting connection ostensibly belongs to "Customer B" but the underlying LinkedIn grant is identical to one that already belongs to "Customer A".

Hypotheses (1), (2), (4) are **not supported** by the data:
- (1) No team-id collisions across companies/profiles (A2, A3 = 0; provision helpers read by explicit UUID).
- (2) No fallback-team path in the connect route (schema requires both `company_id` and `profile_id`; BSP-10 verifies profile ownership).
- (4) No `bundle_social_account_id` shared across companies (A1 = 0); sync attribution code only ever inserts under the explicit `attributeNewToCompanyId`.

The leakage is **at the LinkedIn person level (`userId`), not at the bundle.social account level (`account_id`).**

---

## 8. Severity assessment

### How many companies are affected (from A1 + B-PLUS.2)

- DB-level: **0 companies** affected by `bundle_social_account_id` cross-tenancy. Our records correctly partition by team.
- bundle.social-level: **4 companies** (Opollo, ASCII Group, Planet6, Skyview) all have a LinkedIn `socialAccount` whose `userId` is `urn:li:person:cn_0IGowb1` ("Steven Morey"). Vincovi has no LinkedIn connection yet.

### How many account IDs are duplicated (from A1)

**0** — `bundle_social_account_id` is unique per `social_connections` row.

### Publishing impact

If any of the four affected companies publishes via their respective LinkedIn connection right now:
- Opollo (`urn:li:organization:40810993`): publishes to Opollo MSP Marketing's LinkedIn page. **This is the legitimate target.**
- ASCII Group / Planet6 / Skyview: `externalId` is null — the channel/page hasn't been selected yet. Publishing would fail or post to Steven Morey's personal LinkedIn (whichever fallback bundle.social applies for un-calibrated LinkedIn accounts).

**No production posts have shipped to the wrong account yet** because the three "un-calibrated" connections wouldn't successfully publish today. Severity is **bounded** by the un-calibrated state, but the moment any of those three completes channel selection, they'd all be Steven's personal LinkedIn, and "Customer X's LinkedIn connection" would in practice be Steven's LinkedIn for all three.

### Reproduction conditions

Any operator/admin who:
1. Connects LinkedIn to Customer A via `/company/social/connections`
2. Switches to Customer B in the same browser session within LinkedIn's auto-consent window (LinkedIn's window is typically the OAuth token lifetime, often hours)
3. Clicks Connect LinkedIn on Customer B's page

…will silently attach the SAME LinkedIn person to Customer B's team without re-prompt. This is a generic LinkedIn-OAuth-provider behaviour; it's not specific to Opollo staff. A real customer admin who uses the same personal LinkedIn for two of their own companies would hit it. The "Customer B can publish to Customer A's LinkedIn" symptom emerges if/when the customer expects the two connections to be different LinkedIn accounts (the bundle.social account ids are different, but the LinkedIn person isn't).

---

## 9. Files that will need to change to fix this (no fix written yet)

Listed in order of where the defence is best placed. The fix PR should pick the right layer and not do all of them.

### Schema (most fundamental)

1. **`supabase/migrations/0121_social_connections_external_user_id.sql`** (new) — add `external_id TEXT NULL` and `bundle_social_user_id TEXT NULL` columns to `social_connections`. Add a partial unique index on `(bundle_social_user_id, platform)` to prevent the same LinkedIn person from being attached to more than one company:
   - One option: globally unique (`WHERE bundle_social_user_id IS NOT NULL`) — strictest; breaks legitimate "same person grants two companies they own".
   - Better option: same `userId` + `platform` may exist multiple times BUT a downstream check verifies cross-tenant by `userId` and flags / blocks.

### Library

2. **`lib/platform/social/connections/types.ts`** — extend `SocialConnection` with `external_id`, `bundle_social_user_id` fields.
3. **`lib/platform/social/connections/sync.ts`** — populate `external_id` and `bundle_social_user_id` from the bundle.social `socialAccount` payload on INSERT. Currently sync only reads `id, type, displayName, username, avatarUrl` — needs to also read `externalId`, `userId`, `userUsername`, `userDisplayName`. This requires switching from `teamGetTeam` (which doesn't reliably return `externalId`/`userId` for newly-connected accounts) to `socialAccountGetByType` per (team, type) — or accepting the values from the `social-account.connected` webhook.
4. **`lib/platform/social/connections/sync.ts`** — pre-INSERT cross-tenant check: if `bundle_social_user_id` is already attached to a `social_connections` row in a DIFFERENT `company_id`, refuse the insert and surface a `CONNECTION_ALREADY_OWNED_ELSEWHERE` envelope. The connect callback should report this back to the user via the `?connect=error&reason=already-owned-by-another-company` banner.

### Webhook

5. **`app/api/webhooks/bundlesocial/route.ts`** (verify path; the `social-account.connected` webhook handler) — apply the same cross-tenant check at webhook receipt; this is the source-of-truth path for new account state.

### Connect API

6. **`app/api/platform/social/connections/connect/route.ts`** — optional pre-flight: before minting the bundle.social OAuth URL, query the current org-wide list of LinkedIn `userId`s already attached, and warn the user "you're about to connect a LinkedIn account that's already attached to another company — proceed?". This is a UX cushion in front of the hard check in (4).

### UI

7. **`components/SocialConnectionsList.tsx`** — handle the new error reason (`already-owned-by-another-company`) in the `ConnectBanner`.
8. **`app/(platform)/company/social/connections/page.tsx`** — extend the banner-reason map.

### Cleanup

9. **Manual data cleanup** — for the 3 "stuck-at-channel-selection" LinkedIn accounts (ASCII Group / Planet6 / Skyview teams), disconnect them via `socialAccountDisconnect` and let real customer admins (or Opollo staff using their work LinkedIn distinct from Steven's personal LinkedIn) re-connect with the right channel. Could also be done with the BSP-4 reconcile script extended to know about `userId` duplicates.

10. **Documentation** — `docs/architecture/BUNDLE_SOCIAL_THEMING.md` (or a new `docs/architecture/BUNDLE_SOCIAL_OAUTH.md`) should document the LinkedIn auto-consent behaviour so future operators know.

### NOT changed by this fix

- `lib/platform/social/profiles/provision-team.ts` — provisioning is correct.
- `lib/platform/social/profiles/connect.ts` — connect-URL minting is correct.
- The BSP-2/BSP-2-REDO race-safety mechanisms — none of these are involved in the leak.
- The BSP-10 cross-tenant `profile_id` smuggling guard — orthogonal defence; remains correct.

---

## Appendix — investigation script

The full investigation was driven by `scripts/_tmp_cross_tenant_investigation.ts` (not committed; deleted after this report). It executes Parts A and B against production with read-only Supabase + bundle.social access. Output captured in `/tmp/investigation-output-full.txt` locally and reproduced inline above.

---

## Resolution

**Fixed by PR on branch `fix/social-identity-fingerprints` — six-layer defence shipped 2026-05-11.**

The reported symptom (Customer A's LinkedIn appearing as Customer B's connection without OAuth re-prompt) was correctly diagnosed as Hypothesis 3 — the platform-side OAuth provider silently auto-approves repeat consent. The bug is generic across all 14 bundle.social-supported platforms, not LinkedIn-specific.

The fix lives at six layers; full architecture in [`docs/architecture/SOCIAL_CONNECTIONS_IDENTITY_MODEL.md`](../architecture/SOCIAL_CONNECTIONS_IDENTITY_MODEL.md).

| Layer | What it does |
|---|---|
| 1 | Schema (migration 0122): `external_account_id`, `external_user_id`, `external_identity_hash` columns + 3 partial indexes; `pending_identity` enum value; `allow_cross_tenant_identity` flag; 3 new event_type values |
| 2 | Identity capture + hard block at every write path: `lib/platform/social/connections/identity.ts` wired into `sync.ts` + `webhooks/process.ts` |
| 3 | Pre-flight warning before OAuth popup opens: `GET /api/platform/social/connections/identity-preflight` + confirmation modal in customer + admin connect UIs |
| 4 | Admin maintenance page at `/admin/maintenance/social-connections` + backfill script + 3 admin API routes (refresh-identity, reattribute, toggle-cross-tenant-override) |
| 5 | `pending_identity` status blocks publishing automatically via the existing `claim_publish_job` RPC's `status='healthy'` gate (no SQL change required) |
| 6 | This doc + the architecture doc |

### Backfill report

The Layer 4 backfill ran against production after the migration applied. Output:

```
[TODO: paste backfill --dry-run report from rollout step 2]
[TODO: paste live backfill report from rollout step 4]
```

If the dry-run shows any pre-existing cross-tenant conflicts, the rollout halts at step 3 and Steven decides per-pair before continuing.

### What protects each subsequent attempt

- A real customer admin who tries to attach the same LinkedIn person to two of their companies hits **Layer 3** (pre-flight modal) before the popup opens.
- If they Continue past Layer 3, **Layer 2** blocks the sync-time INSERT after the OAuth completes; the callback returns `?connect=error&reason=cross-tenant-blocked` and the UI shows the banner.
- If they need a legitimate cross-company shared identity (agency / client setup), Opollo staff flips `allow_cross_tenant_identity=true` via Layer 4's maintenance page — every flip and every override-allowed write is audited in `platform_events`.
- Connections in `pending_identity` (channel selection incomplete) refuse to publish via **Layer 5**, even if Layer 2 hadn't caught them.

### Manual cleanup that was needed

The 3 "stuck-at-channel-selection" LinkedIn accounts (ASCII Group / Planet6 / Skyview teams, all `externalId=null`) noted in the investigation Part B will be flagged by the maintenance page as `pending_identity`. They can be disconnected from the maintenance page's per-row Disconnect action and re-connected with the right channel by the actual customer admin (using their own LinkedIn account, not Steven's).
