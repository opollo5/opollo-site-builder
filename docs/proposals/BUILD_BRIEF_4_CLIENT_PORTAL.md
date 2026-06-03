# Build Brief 4 — Client Portal (Social Connections)

CONTRACT-DRIVEN AUTONOMOUS BUILD. DEPENDS ON Brief 1 (magic-link service). Can be built
after Brief 1 — does NOT depend on Briefs 2/3 (proofing). Separate surface from the
proofing review queue. Execute end-to-end, one PR per logical change, migration-first.
Follows Brief 0 §1–2 for magic-link/session behaviour.

> START WITH RECON: re-read docs/recon/CONNECTIONS_CLIENT_ACCESS_RECON.md + Brief 1's
> drift report. CRITICAL corrections from recon (the original brief assumed wrong):
> - `platform_session_grants` (migration 0126) ALREADY EXISTS as the designed home for
>   magic-link reconnect sessions — columns grant_type, scope_connection_id, token_hash,
>   expires_at, second_factor_required. It's a schema stub with zero app code. BUILD ON
>   IT — do NOT invent a new table.
> - Connection model `social_connections` already has a status enum (healthy / degraded /
>   auth_required / disconnected / pending_identity), `expires_at`, `last_validated_at`,
>   and a DAILY health cron. Expiry tracking EXISTS.
> - OAuth binding does NOT use a `state` param — it uses `company_id` in the redirect URL
>   + session cookie, with `external_identity_hash` (lib/platform/social/connections/
>   identity.ts) as the cross-tenant safeguard. Survive the round-trip via THAT mechanism.
> - Public token surfaces /approve/[token], /viewer/[token], /invite/[token] exist —
>   mirror their pattern for the portal route. No portal exists yet (confirmed new surface).

---

## What this is

A **client-facing portal** (separate from the proofing review queue) where an external
client — with NO Opollo account, admitted by magic link — can set up and reconnect their
own social media connections. Two entry modes, two trigger sources:

- **Portal mode**: "set up my accounts" — client lands on a page showing ALL their
  company's connections + status (connected / expired / needs attention) and can
  connect/reconnect any of them.
- **Deep-link mode**: "reconnect this expired one" — link targets a single connection and
  lands the client straight on that connection's reauth.

Triggers:
- **Manual**: admin clicks "request client to connect/reconnect" → sends the client a link.
- **Automatic**: when a connection expires, the system sends the client a reconnect link.

## Locked decisions (Brief 0 + this session)

- Magic link via Brief 1 service, `purpose='reconnect'`. One-time link + same-day session
  + self-serve re-request (Brief 0 §1–2).
- Client portal is a SEPARATE surface from the proofing queue.
- Client has no account; identity = magic-link → session, scoped to one company.

## Step 1 — Connection health (mostly EXISTS — verify, don't rebuild)

Recon: `social_connections` already has the status enum (healthy / degraded /
auth_required / disconnected / pending_identity), `expires_at`, `last_validated_at`,
`idx_connections_expires_at`, and a daily health cron. So expiry IS detectable today.
- Do NOT add expiry columns — they exist.
- The ONLY missing piece for auto-notify is the **pre-expiry warning cron route** (index
  + column exist, route was never written). That's the single greenfield bit here (Step 5).

## Step 2 — Magic-link reconnect plumbing (build on platform_session_grants)

Recon: `platform_session_grants` (migration 0126) is the DESIGNED home — `grant_type`,
`scope_connection_id`, `token_hash`, `expires_at`, `second_factor_required`. Stub with no
app code. Wire it via Brief 1's magic-link service:
- `issue` a `purpose='reconnect'` link backed by a `platform_session_grants` row.
  `scope_connection_id` set = deep-link mode (one connection); null + company scope =
  portal mode (all the company's connections).
- The link lands on the client portal route, establishing the grant-backed session
  (same-day per Brief 0 §2). Do NOT create a new grants/sessions table.

## Step 3 — The client portal route + UI

- A client-facing route (no platform chrome — this is the client's small world, like the
  Gain front door). Admitted by the magic-link session.
- **Portal view**: lists the company's connections with status badges (connected /
  expired / needs attention), each with a Connect / Reconnect action.
- **Deep-link view**: opens straight on the single targeted connection's reauth.
- Reuse the existing connection-status UI components if any exist; match the design system.

## Step 4 — OAuth round-trip identity (the fiddly part — use the EXISTING mechanism)

When the client clicks Connect/Reconnect, the flow bounces to the provider and returns via
OAuth callback. Recon: binding uses `company_id` in the redirect URL + session cookie,
with `external_identity_hash` (lib/platform/social/connections/identity.ts) as the
cross-tenant safeguard — NOT a `state` param. So:
- Carry the magic-link grant + company context through the EXISTING redirect-URL +
  cookie + identity-hash mechanism so the returning callback reattaches correctly. Do NOT
  invent a `state`-param scheme parallel to what exists.
- The existing callback must accept a client-portal-initiated flow and bind the resulting
  connection to the correct company via the identity-hash fingerprint (honour the
  cross-tenant leak fix — this is the safeguard).
- On return, land the client back in the portal with the connection now showing connected.

## Step 5 — Triggers

- **Manual**: an admin action ("request client to connect") → issues the link + sends
  email (dispatch() + a new template, brand shell). Admin picks portal vs specific
  connection.
- **Automatic on expiry**: a check (reuse the QStash/cron pattern — NOT a new cron system)
  that detects expired/expiring connections and sends the client a reconnect link.
  Idempotent (don't spam — one notice per stage per expiry, dedup like the reminder
  ladder). Make this an EXPLICIT component — it is the "auto" half and won't exist unless
  built.

**Portal recipient (who gets the email — was unspecified):** a designated company contact.
Add a `portal_contact_email` (or reuse an existing company-contact field if one exists —
check first) on the company. The reconnect/connect emails go to that contact. If none set,
fall back to the company's primary admin contact and flag to the Opollo operator that no
client contact is configured.

**Notification cadence (was unspecified — lock it):** pre-expiry warning at **7 days** and
**1 day** before `expires_at`, and **on expiry** (status → auth_required/disconnected).
One notice per stage, idempotent. Reuse the reminder-ladder dedup pattern.

## Step 5a — Failure-state contract (define these — do not let the builder invent)

| State | Behaviour |
|-------|-----------|
| Expired link | Show "link expired" + self-serve re-request (enter email → fresh link, B0 §1) |
| Revoked link | Show "this link is no longer valid, contact your account manager" — no self-serve |
| Connection deleted / no longer exists | Portal shows it as removed; deep-link falls back to portal view |
| Company inactive | Block access, show a neutral "unavailable" page, alert Opollo operator |
| OAuth failure / reconnect failed | Land back in portal, connection shows failed + "try again" |
| Wrong-company attempt (security) | Hard refuse via identity-hash/RLS; never expose another company's data |

## Step 6 — Tests + verify
Manual request issues + sends link; expiry auto-detect fires once per expiry; client
admits via link → portal lists connections with correct status; deep-link lands on the
right connection; OAuth round-trip returns and binds to the correct company (NOT an
operator, NOT cross-tenant); same-day session + re-request work. L18 Definition of Done.

## Constraints
Consume Brief 1's magic-link service — no second token system. Honour the existing
cross-tenant OAuth binding fix. QStash-only for the expiry check. Client portal is its own
surface, no operator chrome. Transactional, idempotent, preserve audit, RLS (the company
binding is security-critical — a client must only ever touch their own company's
connections), mirror route conventions.

## Known hazards (builder must respect)

1. **No scheduling write path.** B4 is reconnect + approval only. B4 must have NO write
   path that sets `social_post_drafts.state = 'scheduled'`. The V2 publish-due cron
   (`claimDueDrafts`) has no company-level guard — any draft that reaches
   `state = 'scheduled'` enters the live publish path unconditionally. B4 never produces
   a scheduled draft, keeping the cron exposure moot. If any B4 code path could
   conceivably set `state = 'scheduled'`, flag it before merging. See
   `docs/backlog/cron-guard-missing.md`.

2. **Cross-tenant binding is the security keystone.** The LinkedIn cross-tenant leak
   (2026-05-11) was fixed via `external_identity_hash`. Any OAuth round-trip in B4 must
   honour that binding — a client must only ever touch their own company's connections.
   The existing `checkCrossTenantConflict()` in `lib/platform/social/connections/identity.ts`
   is the guard. Do not bypass or replicate it.

3. **`platform_session_grants.user_id` is NOT NULL.** The stub table was designed for
   authenticated-user reconnect sessions (a platform user getting a magic link to reconnect
   their own account). An external client who has no platform account cannot be stored there
   directly. B4 may need a nullable `user_id` migration on `platform_session_grants`, or a
   separate binding mechanism. This is a hard stop — show Steven the migration shape before
   running. See `docs/recon/CONNECTIONS_CLIENT_ACCESS_RECON.md` for the stub details.

4. **No prod writes during verification.** B4 verification must run against local Supabase
   only. See CLAUDE.md §"Production database is never a test environment".

## Report
PRs, migration prod-verified, live verification (esp. the OAuth round-trip binds to the
right company), and any drift.
