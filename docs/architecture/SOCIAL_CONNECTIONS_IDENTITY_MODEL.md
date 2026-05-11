# Social connections — identity model

**Status:** Active. Migration 0122 shipped. Backfill produced clean report.

This document describes how the bundle.social integration identifies the
platform-side identity behind every `social_connections` row, and how
that identity is used to prevent cross-tenant publishing leaks.

## Why this exists

The incident at
[`docs/incidents/2026-05-11-bundle-social-cross-tenant-leak.md`](../incidents/2026-05-11-bundle-social-cross-tenant-leak.md)
documented a real cross-tenant leak: a person who authorises bundle.social
for the same platform across multiple companies in one browser session
ends up attached to each company's bundle.social team **without
re-prompting**. The platform-side OAuth provider (LinkedIn observed;
behaviour is generic across providers — Facebook, Instagram, Threads,
TikTok all auto-approve repeat consent from a logged-in user) silently
re-issues an auth code. bundle.social creates a fresh `socialAccount`
record on the target team. Each record has a distinct bundle.social `id`,
so our DB stores them as separate rows — but they all transit through
the same underlying platform-side identity. Publishing from any of these
rows posts as the same person on the platform.

The bug is at the **platform-side identity** level, not at any
bundle.social or DB id level. Deduping by `bundle_social_account_id`
alone misses it (each connection has a unique id). The fix needs a
deeper fingerprint.

## The fingerprint

Every `social_connections` row carries three identity columns (migration
0122):

| Column | Meaning |
|---|---|
| `external_account_id` | The platform's account/page/channel id — the "thing being posted to" |
| `external_user_id` | The platform's identity of the human who granted OAuth — the "who is authorised" |
| `external_identity_hash` | `md5(platform || ':' || external_account_id || ':' || external_user_id)`. Computed by `computeIdentityHash` in TypeScript on every insert/update. Indexed; the cross-tenant detector hits this index. |

`external_identity_hash` is NULL when both `external_account_id` and
`external_user_id` are NULL — the connection is in
`status='pending_identity'` until the user completes channel selection
on the platform side. Publishing refuses `pending_identity` via the
existing `claim_publish_job` RPC's `status='healthy'` gate.

## Per-platform identity table

Identity-field semantics for each bundle.social-supported platform.
Resolved from `socialAccountGetByType` on the bundle.social SDK. When
we add a new platform, fill in the row here and the rest of the system
works platform-agnostically — there is no per-platform branch in the
identity lib or the cross-tenant detector.

| Platform | `external_account_id` from | `external_user_id` from | Notes |
|---|---|---|---|
| LINKEDIN | `externalId` (`urn:li:person` or `urn:li:organization`) | `userId` (`urn:li:person`) | userId is the human; externalId differs when posting as a Page vs a person |
| FACEBOOK | `externalId` (FB Page id) | `userId` (FB user id) | Distinct: Page id ≠ user id |
| INSTAGRAM | `externalId` (IG account id) | `userId` (FB user id; IG via FB graph) | userId is the FB grantor |
| YOUTUBE | `externalId` (YouTube channel id) | `userId` (Google account id) | Channel ≠ account |
| GOOGLE_BUSINESS | `externalId` (Location id) | `userId` (Google account id) | Location ≠ account |
| TWITTER (X) | `externalId` (X user id) | `userId` (same as externalId) | Account == user |
| TIKTOK | `externalId` (TikTok account id) | `userId` (same as externalId) | Account == user |
| PINTEREST | `externalId` (Pinterest user id) | `userId` (same as externalId) | Account == user |
| THREADS | `externalId` (Threads account id) | `userId` (same as externalId) | Account == user |
| REDDIT | `externalId` (Reddit user id) | `userId` (same as externalId) | Account == user |
| BLUESKY | `externalId` (Bluesky DID) | `userId` (same as externalId) | Account == user |
| MASTODON | `externalId` (Mastodon account URL) | `userId` (same as externalId) | Account == user |
| DISCORD | `externalId` (guild/channel id) | `userId` (Discord user id) | Distinct |
| SLACK | `externalId` (channel/workspace id) | `userId` (Slack user id) | Distinct |

For platforms where account and user are conceptually the same (X, TikTok,
Pinterest, Threads, Reddit, Bluesky, Mastodon), both columns are populated
to the same value so the cross-tenant detector fires symmetrically on
either column.

**Adding a new platform:** add the row above, then verify
`resolveIdentityFingerprint` and `checkCrossTenantConflict` work with the
new platform value (they should — both are platform-agnostic). Cover
the new platform in
`lib/__tests__/social-identity-cross-tenant.test.ts`.

## The six layers

Defence in depth. The block at each layer catches the case the next-
inner layer misses.

### Layer 1 — schema

Migration `0122_social_connections_identity_fingerprints.sql`:
- Three identity columns + partial indexes on each.
- `pending_identity` enum value on `social_connection_status`.
- `allow_cross_tenant_identity` operator-override on `platform_companies`.
- Three new `event_type` values on `platform_events` for the audit trail.

### Layer 2 — identity capture + hard block at write

`lib/platform/social/connections/identity.ts`:
- `resolveIdentityFingerprint({ platform, teamId })` — calls
  `socialAccountGetByType` and returns the three identity fields. Source
  of truth; `teamGetTeam` sometimes returns null `externalId` for
  newly-connected accounts.
- `computeIdentityHash(platform, account_id, user_id)` — deterministic
  md5. Null when both ids are null.
- `checkCrossTenantConflict(...)` — queries `social_connections` by
  identity_hash, then by `(platform, external_account_id)`, then by
  `(platform, external_user_id)`. Returns `{ok: true}` on no conflict,
  or `{ok: false, code: 'CROSS_TENANT' | 'CROSS_PROFILE', override_allowed, conflicting_rows}` on conflict.

**Conflict classification:**
- **Cross-tenant** — any partial-identity match across companies.
  Same hash, same account_id only, or same user_id only — all flagged
  if the matching row's `company_id ≠ target_company_id`. Always
  blocked unless the target company has `allow_cross_tenant_identity=true`.
- **Cross-profile** — full-hash match within the same company across
  profiles. Same hash + same company + different profile = block.
  Same `external_user_id` across profiles within one company is NOT
  blocked — that's legitimate "same human owns two different pages."

The block fires at every INSERT/UPDATE write point:
- `lib/platform/social/connections/sync.ts` (post-callback INSERT path)
- `lib/platform/social/webhooks/process.ts` (social.account.connected
  handler — flips status to `healthy` only when both identity fields
  are populated; otherwise leaves at `pending_identity`)
- `app/api/admin/maintenance/social-connections/[id]/reattribute/route.ts`
  (Layer 4 reattribute action, excluding self from the check)

Audit events:
- `cross_tenant_blocked` — every refused write.
- `cross_tenant_override` — every write that proceeded under
  `allow_cross_tenant_identity=true`, plus every toggle of that flag.
- `connection_reattributed` — every Layer 4 reattribute.

### Layer 3 — pre-flight at connect

`/api/platform/social/connections/identity-preflight`:
- GET endpoint, scoped to the current authenticated user.
- Returns `{ warn: true, others: [{company_name, connected_at}] }` when
  another company the user can see has the same platform connected.
- For non-staff: scope = user's `platform_company_users` memberships
  minus the target.
- For Opollo staff: scope = any company with a recently-connected
  (last 24h) row for the same platform.

UI integration:
- `components/SocialConnectionsList.tsx` (customer)
- `components/AdminProfileConnectionsList.tsx` (admin)

Both call the preflight before opening the OAuth popup. When `warn=true`,
they render a confirmation modal explaining what will happen if the
OAuth flow auto-approves. Modal is platform-agnostic — same copy
template, platform name substituted.

This is a **warning**, not a block. The hard block is Layer 2.

### Layer 4 — admin maintenance page

`/admin/maintenance/social-connections`:
- Cross-company table (not nested under any company route).
- Sortable by every column; default sort `external_identity_hash` so
  duplicates land adjacent.
- Filter chips: company, platform, status, has_duplicate.
- Banner runs the cross-tenant detector on every render. Green when
  clean; red+expandable with full conflict listing when not.
- Per-row actions:
  - **Refresh** — re-runs `socialAccountGetByType` and rewrites the
    identity columns. Useful when bundle.social returned null externalId
    on initial connect and channel selection has since completed.
  - **Reattribute** — moves a connection's `company_id` + `profile_id`
    to a new target. Runs `checkCrossTenantConflict` on the new target
    (excluding self) before mutating.
  - **Disconnect** — calls the existing disconnect helper.
  - **Toggle override** — sets/unsets
    `allow_cross_tenant_identity` on the row's company. Confirmation
    modal + audit event.

Backfill script `scripts/bundlesocial-backfill-identities.ts`:
- Idempotent, resumable (state in `os.tmpdir()`), rate-limited
  (10 SDK calls/sec).
- `--dry-run` flag.
- Reports cross-tenant duplicates at the end. Never mutates
  pre-existing conflicts — operator resolves via the maintenance page.

### Layer 5 — publishing gate + `pending_identity` status

The existing `claim_publish_job` RPC (migration 0096) already refuses
non-`'healthy'` connections. Adding `pending_identity` to the
`social_connection_status` enum (migration 0122) means publishing
automatically refuses connections whose identity hasn't been resolved.

No publish-path code change needed — the SQL gate at
`supabase/migrations/0096_claim_publish_job_cap_check.sql:155`
(`IF v_conn.status <> 'healthy' THEN RETURN 'CONNECTION_DEGRADED'`)
covers the new status.

`fire.ts` and `retry.ts` both already handle the
`connection_degraded` outcome — surfacing a clear error to the
operator who attempted the publish.

### Layer 6 — documentation

This document, plus the resolved incident at
[`docs/incidents/2026-05-11-bundle-social-cross-tenant-leak.md`](../incidents/2026-05-11-bundle-social-cross-tenant-leak.md).

## Operator override: `allow_cross_tenant_identity`

When two real companies legitimately share a social account — for
example, an agency that publishes to its client's Facebook Page on
the client's behalf with the client's consent — set
`platform_companies.allow_cross_tenant_identity=true` on the target
company via the maintenance page.

**Effects:**
- Cross-tenant blocks for that company log a `cross_tenant_override`
  event and proceed, instead of refusing.
- Cross-profile blocks (same company, different profile, same hash)
  are still refused — the override is for *cross-tenant* only.
- Every override flip and every override-allowed write is audited
  in `platform_events`.

**When to use:** only when you've confirmed (in writing) that both
companies want the shared identity. Default-off for safety.

**When NOT to use:** as a quick fix for a confused state. If you're
unsure, use **Reattribute** or **Disconnect** in the maintenance
page first.

## The `pending_identity` status

A connection is `pending_identity` when bundle.social has accepted
the OAuth grant but the platform-side identity hasn't been fully
resolved. Typical causes:

- LinkedIn: user authorised but hasn't selected which organization
  page to manage.
- Facebook / Instagram: user authorised but hasn't selected the Page
  they want connected.
- YouTube: user authorised but hasn't selected the channel.

The next call to `socialAccountGetByType` returns the resolved
`externalId` / `userId` — at which point the sync flow or the
maintenance page's **Refresh** action flips the status to `healthy`.

Publishing is refused while `pending_identity` (Layer 5 gate). The
customer-facing connection list renders an amber pill with the label
"Pending channel selection."

## Runbook — when the maintenance banner shows duplicates

1. **Open the maintenance page** at `/admin/maintenance/social-connections`.
2. **Click the banner** to expand the conflict list.
3. For each conflict pair, decide one of:
   - **(a) Disconnect** — if the new connection is a mistake / test
     account. Use the per-row Disconnect action.
   - **(b) Reattribute** — if the connection belongs to a different
     company than it landed under. Use Reattribute and supply the
     correct `company_id` / `profile_id`.
   - **(c) Enable cross-tenant override** — if both companies
     legitimately share the identity (agency / client setup, etc.).
     Confirm with the customer in writing before flipping.
4. **Click Refresh** on any row with `pending_identity` status to
   re-resolve identity from bundle.social.
5. **Re-load the page** and confirm the banner is green.
