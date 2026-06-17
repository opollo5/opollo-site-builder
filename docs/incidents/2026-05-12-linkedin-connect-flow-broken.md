# Incident — bundle.social LinkedIn connect — 2026-05-12

> **Status**: investigation. Documents the gap between the bundle.social
> connect contract (per
> [https://info.bundle.social/api-reference/connect-social-accounts](https://info.bundle.social/api-reference/connect-social-accounts))
> and the code we ship today. **No fix in this branch** — fix lands in a
> separate hotfix branch.

---

## 1. Executive summary

- **The OAuth dance itself works.** bundle.social returns a usable
  `socialAccountConnect` URL; the user can complete LinkedIn OAuth in
  the popup; bundle.social creates a `socialAccount` on the team. Our
  callback receives the redirect.
- **The post-OAuth channel-selection step is entirely missing.**
  LinkedIn (and FACEBOOK, INSTAGRAM, YOUTUBE, GOOGLE_BUSINESS) require
  a second call — `POST /api/v1/social-account/set-channel` — after
  OAuth, to bind the freshly-created `socialAccount` to a specific
  LinkedIn organization / FB page / IG page / YT channel / GBP
  location. Until that second call lands, the account sits with
  `channels: []` and **cannot post**. We never make that call. We
  never render UI for the user to pick a channel. We never even fetch
  the channel list.
- **Our callback only recognises four error params.** It listens for
  `not-enough-permissions`, `not-enough-pages`, `auth-failed`,
  `user-cancelled` (generic, unprefixed). The bundle.social contract
  appends a **platform-prefixed** completion / error signal on every
  callback: `linkedin-callback=`, `linkedin-not-enough-channels=`,
  `linkedin-not-enough-permissions=`, and the equivalents for every
  other platform. None of these match our `find` list, so the
  callback falls through to the `noop` branch — the popup closes
  silently and the user sees no error and no next step.
- **The customer-facing UI has no channel-picker state.** Both
  `SocialConnectionsList` and `AdminProfileConnectionsList` react to
  the popup-complete `postMessage` by calling `router.refresh()` and
  nothing else. There is no UI state for "OAuth completed but channel
  not chosen yet", no `pending_channel` status display, no picker
  modal, no flow to call set-channel.
- **Net effect**: the user clicks Connect, completes LinkedIn auth,
  the popup closes with no visible error, the connection appears in
  our DB (`channels: []` on bundle.social side), and the customer
  cannot understand why posts won't go out. The bundle.social
  dashboard shows the account in an "error" state because no channel
  has been selected.

## 2. Contract vs implementation

For each contract point in the bundle.social docs, current status and
where it lives (or where it needs to live).

| # | Contract requirement | Status | Where in our code |
|---|---|---|---|
| C1 | Call `socialAccount.socialAccountConnect({ type, teamId, redirectUrl })` to mint an OAuth URL. | ✅ IMPLEMENTED | `lib/platform/social/profiles/connect.ts:158-166` |
| C2 | Open the URL in the browser; user completes OAuth at the provider. | ✅ IMPLEMENTED | `components/SocialConnectionsList.tsx` (popup open + poll); `components/AdminProfileConnectionsList.tsx:225` |
| C3 | bundle.social redirects back to `redirectUrl` with a **platform-prefixed completion param** — e.g. `?linkedin-callback=true&company_id=…`. | ❌ MISSING (read) | `app/api/platform/social/connections/callback/route.ts:117-122` checks only `not-enough-permissions / not-enough-pages / auth-failed / user-cancelled`. The `linkedin-callback=true` query string is silently dropped; control flows into the `noop` branch. |
| C4 | bundle.social may append **platform-prefixed error params** — e.g. `?linkedin-not-enough-channels=true`, `?linkedin-not-enough-permissions=true`, `?facebook-not-enough-pages=true`, `?instagram-not-enough-permissions=true`, `?youtube-not-enough-channels=true`. | ❌ MISSING | Same call site: `app/api/platform/social/connections/callback/route.ts:117-122`. Our four generic strings never match these. |
| C5 | After OAuth, for **channel-selection platforms** (LINKEDIN, FACEBOOK, INSTAGRAM, YOUTUBE, GOOGLE_BUSINESS), fetch the freshly-discovered channels via `socialAccount.socialAccountRefreshChannels({ type, teamId })` → returns `{ channels: Array<{id, name, username, address, avatarUrl, webhook, metadata}> \| null }`. | ❌ MISSING | Zero call sites. SDK type at `node_modules/bundlesocial/dist/index.d.ts:801-820` is unused. |
| C6 | Render a channel-picker UI showing the returned channels; the user picks one. | ❌ MISSING | No such component exists. `SocialConnectionsList` and `AdminProfileConnectionsList` have no channel state, no picker dialog, no related testids. |
| C7 | Call `socialAccount.socialAccountSetChannel({ type, teamId, channelId })` once the user picks. | ❌ MISSING | Zero call sites. SDK at `node_modules/bundlesocial/dist/index.d.ts:801-820`. No route handler exists. |
| C8 | Support `socialAccount.socialAccountUnsetChannel({ type, teamId })` to let the user clear and re-pick (or detach without a full OAuth re-auth). | ❌ MISSING | Zero call sites. SDK exposes the method; we never call it. |
| C9 | Block publishing on accounts with `channels: []` — bundle.social will reject the post; we should refuse upstream with a clear "pending channel selection" status. | ❌ MISSING | The DB has `social_connections.status = 'pending_identity'` (migration 0122) which gates publishing via the `claim_publish_job` RPC, but **nothing flips a connection to `pending_identity` after OAuth-without-channel**. `sync.ts` and the `social.account.connected` webhook handler at `lib/platform/social/webhooks/process.ts:374-455` set status to `'healthy'` purely based on whether `externalId` / `userId` are populated. For LinkedIn the SDK returns those even when `channels: []`, so a channel-less account is wrongly marked `'healthy'`. |
| C10 | Where supported (FB, IG-via-FB, TikTok only — explicitly NOT LinkedIn per docs), pass `disableAutoLogin: true` to force a fresh OAuth login. | ⚠️ WRONG | `app/api/platform/social/connections/connect/route.ts:111` sends `disableAutoLogin: true` unconditionally. Benign for LinkedIn (SDK ignores it) but a documentation drift smell. Should be a per-platform allowlist. |
| C11 | For FB/IG only, `withBusinessScope: true` adds `business_management / ads_management / ads_read` scopes. | ✅ IMPLEMENTED | `app/api/platform/social/connections/connect/route.ts:61-64,112`. |
| C12 | Direct-OAuth flow uses `socialAccountConnect` (per-platform URL); the hosted-portal alternative uses `socialAccountCreatePortalLink` (multi-platform picker page). We are on direct-OAuth. | ✅ IMPLEMENTED | `lib/platform/social/profiles/connect.ts` exclusively uses `socialAccountConnect`. |

**Summary**: 4 of 12 contract points are correctly handled. The eight
gaps cluster into three families — **callback param recognition**
(C3, C4), **the channel-selection flow** (C5, C6, C7, C8), **status
representation** (C9, C10).

## 3. Why "OAuth error" appears on the bundle.social dashboard

Sequence we believe is firing:

1. User clicks **Connect LinkedIn** in our UI.
2. We `POST /api/platform/social/connections/connect`. Route returns
   the `socialAccountConnect` URL; popup opens.
3. User authorises bundle.social on LinkedIn. LinkedIn redirects back
   to bundle.social. bundle.social creates the `socialAccount` row on
   the team. Because LinkedIn is a channel-selection platform,
   bundle.social leaves `channels: []` waiting for a `set-channel`
   call.
4. bundle.social redirects the popup to our callback with a URL like:
   `…/api/platform/social/connections/callback?company_id=…&popup=1&linkedin-callback=true`
5. Our callback at
   `app/api/platform/social/connections/callback/route.ts:117-122`
   iterates the **generic** error keys and matches none. It then
   reaches the `sync` block, which inserts the row. Because the SDK
   returns a populated `externalId` (LinkedIn `urn:li:person:…`) and
   `userId` even before `set-channel` lands, the identity layer
   accepts it. `sync.data.inserted > 0` so the callback resolves to
   `connectParam: 'success'`.
6. Popup posts `bundle-connect-complete` back to opener. UI calls
   `router.refresh()`. Connection appears in the customer's list as
   "connected", with no surfaced warning.
7. Meanwhile, on the bundle.social dashboard, the account shows as
   needing channel selection. From their UI's perspective this reads
   as "the customer's app never completed the flow" — surfaced as an
   error/warning state on their side.
8. First publish attempt later: bundle.social rejects (no channel
   bound). The publisher worker surfaces a generic error. The
   customer can't fix it because there is no UI affordance.

Note: this is consistent with what Steven observed — popup closes
without an obvious error, but the bundle.social dashboard flags the
account.

## 4. Files to change (fix prompt)

Grouped by concern. Order matches recommended implementation order.

### Schema

- `supabase/migrations/0123_social_connection_pending_channel.sql` —
  add `pending_channel` value to `social_connection_status` enum and a
  partial index on `(platform, status='pending_channel')` for the
  channel-picker query. Document the new status in the doc-comment.

### Server — SDK wrappers

- `lib/platform/social/connections/channels.ts` (new) — three exported
  functions:
  - `refreshAndListChannels({ teamId, platform }) → { ok, channels[] }`
    wraps `socialAccountRefreshChannels`. Returns the channel array
    structurally typed.
  - `setChannel({ teamId, platform, channelId }) → { ok }` wraps
    `socialAccountSetChannel`. After success, re-resolves the identity
    fingerprint (the channel choice changes `externalId` for LinkedIn /
    GBP / YT) and flips the row from `pending_channel` →
    `healthy` (via the cross-tenant check, same path as Layer 2).
  - `unsetChannel({ teamId, platform }) → { ok }` wraps
    `socialAccountUnsetChannel`. Flips the row back to `pending_channel`.

### Server — routes

- `app/api/platform/social/connections/callback/route.ts` — extend
  the error-param list with **platform-prefixed** keys:
  - Treat any `<platform>-callback=true` as the success signal (not
    just "fall through").
  - Treat `<platform>-not-enough-channels=true`,
    `<platform>-not-enough-permissions=true`,
    `<platform>-not-enough-pages=true` as error signals; map to
    `connect=error&reason=not-enough-channels` etc.
  - After a successful sync, for channel-selection platforms, leave
    the row at `pending_channel` (NOT `healthy`) and surface a
    `connect=channel-required` redirect param so the UI knows to open
    the picker.
- `app/api/platform/social/connections/channels/list/route.ts` (new) —
  `GET` returning `{ channels: [] }` for a `(company_id, profile_id,
  platform)` triple. Wraps `refreshAndListChannels`. Gated by
  `manage_connections`.
- `app/api/platform/social/connections/channels/set/route.ts` (new) —
  `POST { profile_id, platform, channel_id }` wrapping `setChannel`.
  Gated by `manage_connections`.
- `app/api/platform/social/connections/channels/unset/route.ts` (new)
  — `POST { profile_id, platform }` wrapping `unsetChannel`.

### Server — sync + webhook updates

- `lib/platform/social/connections/sync.ts` — when inserting a row for
  a channel-selection platform with `channels: []` on the bundle.social
  side, set `status='pending_channel'` (not `'pending_identity'`,
  which is a separate failure mode).
- `lib/platform/social/webhooks/process.ts` — in the
  `social.account.connected` handler at `:374-455`, do not set
  `status='healthy'` unconditionally. For channel-selection platforms,
  check `channels[]` length; if empty, set `pending_channel`.

### Server — publishing gate

- The existing `claim_publish_job` RPC (migration 0096) already refuses
  non-`'healthy'` statuses, so `pending_channel` is auto-gated once
  the status flips correctly. No SQL change needed — but add a
  regression test that drives a `pending_channel` row through
  `fire.ts` and asserts `CONNECTION_DEGRADED` is returned with a
  channel-selection-friendly error message.

### Client — UI

- `components/SocialConnectionsList.tsx` and
  `components/AdminProfileConnectionsList.tsx` — after the
  `bundle-connect-complete` postMessage, if the connect query param is
  `channel-required` (or, after `router.refresh()`, the connection
  rendered has `status='pending_channel'`), open the channel-picker
  modal.
- `components/SocialChannelPickerModal.tsx` (new) — fetches
  `/channels/list`, shows each channel with `name`, `username`,
  `avatarUrl`. Selecting one posts to `/channels/set` and closes the
  modal. Render a "Change channel" affordance on connected
  `pending_channel` rows so the user can re-open the picker at any
  time. A "Disconnect" affordance from the picker calls `/unset` then
  `/disconnect`.

### Tests

- `lib/__tests__/social-connections-channels.contract.test.ts` (Layer 2)
  — snapshot the request body sent to `socialAccountSetChannel`,
  `socialAccountUnsetChannel`, `socialAccountRefreshChannels` for every
  channel-selection platform.
- `lib/__tests__/social-callback-platform-prefixed-params.test.ts`
  (Layer 3) — drive every `<platform>-callback`,
  `<platform>-not-enough-channels`, `<platform>-not-enough-permissions`,
  `<platform>-not-enough-pages` param through the callback route and
  assert the resulting redirect param.
- `lib/__tests__/social-pending-channel-publishing.test.ts` (Layer 3,
  regression) — insert a `pending_channel` row; attempt to claim a
  publish job; assert `CONNECTION_DEGRADED`.
- `e2e/social-channel-picker.spec.ts` (Layer 5) — full happy path:
  click Connect LinkedIn → complete a mocked OAuth → channel-picker
  opens → choose channel → row flips to `healthy`.
- `scripts/probes/bundle-social.ts` — add a probe case for
  `socialAccountRefreshChannels` + `socialAccountSetChannel` against a
  test team.

### Docs

- `docs/architecture/SOCIAL_CONNECTIONS_IDENTITY_MODEL.md` — extend the
  status table to describe `pending_channel`; cross-reference this
  incident doc as the source of the new layer.
- Resolution row added to this incident doc once the fix PR merges.

## 5. Open questions for Steven

These genuinely lack a default-pick from the existing spec; will block
the fix branch until answered.

1. **LinkedIn — personal vs organization-only?** Customers in the
   first run will mostly want to post as their company's LinkedIn
   organization page. Should the channel picker hide
   `urn:li:person:*` channels (so the user can't accidentally connect
   their personal profile)? Or show all channels and label which is
   which?
2. **Multi-channel per profile?** A single LinkedIn user may admin
   several organization pages. Does an Opollo profile bind to **one**
   LinkedIn channel (current implicit model — one row per
   `(profile, platform)`) or **many** (e.g. an agency profile that
   posts to several client pages)? If many, the `social_connections`
   uniqueness constraint changes shape.
3. **Set-channel grace period?** What status do we show the customer
   in the seconds between popup-close and them clicking the
   channel-picker modal? Suggest: a banner reading "Connecting…
   pick a LinkedIn page below" with the connection row hidden until
   `healthy`. Confirm.
4. **Unset-on-disconnect ordering?** When the user disconnects a
   channelled LinkedIn account, do we (a) call `unsetChannel` then
   `socialAccountDisconnect`, or (b) just `socialAccountDisconnect`
   and let bundle.social clean up the channel binding? Docs are
   ambiguous; probe-test will tell us.
5. **GOOGLE_BUSINESS specifics?** GBP locations have a separate
   discovery flow (the user authorises an account, then we list
   `locations`). Is GBP in-scope for the same channel-picker, or does
   it deserve its own UI (location browser + map preview)? Suggest:
   reuse the picker for v1; revisit if customer feedback demands a
   richer location browser.

## 6. Production state (I6)

Bundle.social production state as of the total-nuke verified on
2026-05-11: **0 LinkedIn accounts**, 0 social_connections rows for
LinkedIn, 0 stragglers. The investigation is therefore against the
**code path**, not against extant production data. No backfill is
needed for the fix — the next LinkedIn connect attempt will exercise
the new flow from a clean slate.

## 7. Investigation evidence

Files read in this investigation:

| File | Lines | Finding |
|---|---|---|
| `app/api/platform/social/connections/callback/route.ts` | full (205) | C3, C4 missing — `find()` only matches 4 generic keys |
| `lib/platform/social/profiles/connect.ts` | full (371) | C1 implemented; C5, C6, C7, C8 absent (no setChannel / unsetChannel / refreshChannels references) |
| `app/api/platform/social/connections/connect/route.ts` | full (136) | C10 wrong (unconditional `disableAutoLogin`); C11 implemented |
| `components/SocialConnectionsList.tsx` | partial (220) | C6 absent — postMessage just calls `router.refresh()` |
| `components/AdminProfileConnectionsList.tsx` | full (430) | C6 absent — same pattern, no channel state |
| `lib/platform/social/webhooks/process.ts` | grep + line 374 | C9 wrong — `social.account.connected` sets `'healthy'` regardless of `channels[]` |
| `node_modules/bundlesocial/dist/index.d.ts` | `:801-820, 12400-12500` | SDK exposes `socialAccountSetChannel / socialAccountUnsetChannel / socialAccountRefreshChannels` for LINKEDIN, FACEBOOK, INSTAGRAM, YOUTUBE, GOOGLE_BUSINESS (set/unset) + DISCORD, SLACK, REDDIT, PINTEREST also for refresh |

Grep results across `lib/`, `app/`, `components/`:

- `setChannel|set-channel|set_channel`: zero matches outside `node_modules` and the cross-tenant migration 0122 (unrelated — `social_channels` is a different surface).
- `socialAccountSetChannel|socialAccountUnsetChannel|socialAccountRefreshChannels`: zero matches in our source.
- `linkedin-callback|linkedin-not-enough`: zero matches.

## 8. Ready-to-paste prompt for Claude Code on the hotfix branch

```
You are working on hotfix/linkedin-channel-selection-flow.
Read docs/incidents/2026-05-12-linkedin-connect-flow-broken.md first.
The investigation in that doc is canonical — your job is the fix.

Implementation order (matches Section 4 of the incident doc):

  1. Migration 0123 — add `pending_channel` to `social_connection_status` enum.
  2. lib/platform/social/connections/channels.ts — SDK wrappers
     for refreshAndListChannels / setChannel / unsetChannel.
  3. Callback param recognition (Section 4 → "Server — routes" → first bullet).
  4. New API routes: /channels/list, /channels/set, /channels/unset.
  5. sync.ts + webhooks/process.ts status handling (Section 4 →
     "Server — sync + webhook updates").
  6. UI: channel-picker modal + integration in SocialConnectionsList
     and AdminProfileConnectionsList.
  7. Tests per Section 4 → "Tests".

Hard floors:
  - Contract test for every set/unset/refresh call (snapshot per platform).
  - Layer-3 test driving every <platform>-* callback param.
  - e2e for the full happy path with a mocked OAuth.
  - Regression test pinning the pending_channel → CONNECTION_DEGRADED behaviour.

Surface questions 1-5 from Section 5 of the incident doc BEFORE
implementing the picker UI — those answers shape the picker shape
and the uniqueness constraint.

Follow standard auto-merge rules in CLAUDE.md.
```
