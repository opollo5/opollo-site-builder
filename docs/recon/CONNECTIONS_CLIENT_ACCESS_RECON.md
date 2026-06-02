# Connections & Client Access Recon

Date: 2026-06-02  
Purpose: Pre-Brief-4 (client portal) deep investigation of social connections data model, OAuth flows, client-facing surfaces, and platform capabilities.

---

## Q1 — Connection Data Model

### Migrations that create / extend social_connections

| Migration | What it does |
|---|---|
| `0070_platform_foundation.sql` | Creates `social_connections` (L5) and `social_connection_alerts` |
| `0110_social_connections_expiry.sql` | Adds `expires_at TIMESTAMPTZ NULL`, `last_validated_at TIMESTAMPTZ NULL` |
| `0116_platform_companies_bundle_social_team_id.sql` | Adds `bundle_social_team_id TEXT NULL` on `platform_companies` |
| `0118_platform_social_profiles.sql` | Creates `platform_social_profiles`; adds `bundle_social_team_id` per-profile |
| `0120_social_connections_profile_id.sql` | Adds `profile_id UUID NULL REFERENCES platform_social_profiles(id) ON DELETE SET NULL` |
| `0122_social_connections_identity_fingerprints.sql` | Adds `external_account_id TEXT NULL`, `external_user_id TEXT NULL`, `external_identity_hash TEXT NULL`; adds `pending_identity` to `social_connection_status` enum |
| `0123_social_connections_channel_selection.sql` | Adds `is_personal_mode BOOLEAN NOT NULL DEFAULT false`, `has_emitted_overdue_event BOOLEAN NOT NULL DEFAULT false` |

### Canonical table definition (assembled from all migrations)

**Table: `social_connections`**

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `company_id` | UUID NOT NULL | FK → `platform_companies(id) ON DELETE CASCADE` |
| `profile_id` | UUID NULL | FK → `platform_social_profiles(id) ON DELETE SET NULL` (mig 0120) |
| `platform` | `social_platform` NOT NULL | Enum: `linkedin_personal`, `linkedin_company`, `facebook_page`, `x`, `gbp` (original enum); extended at app layer to all bundle.social platforms |
| `bundle_social_account_id` | TEXT NOT NULL UNIQUE | The bundle.social `socialAccount.id` |
| `display_name` | TEXT NULL | |
| `avatar_url` | TEXT NULL | |
| `status` | `social_connection_status` NOT NULL DEFAULT `'healthy'` | Enum: `healthy`, `degraded`, `auth_required`, `disconnected`, `pending_identity` (mig 0122) |
| `last_error` | TEXT NULL | |
| `connected_at` | TIMESTAMPTZ NOT NULL DEFAULT `now()` | |
| `disconnected_at` | TIMESTAMPTZ NULL | |
| `last_health_check_at` | TIMESTAMPTZ NOT NULL DEFAULT `now()` | |
| `expires_at` | TIMESTAMPTZ NULL | mig 0110 — populated by webhook/cron |
| `last_validated_at` | TIMESTAMPTZ NULL | mig 0110 — set by daily health cron |
| `external_account_id` | TEXT NULL | mig 0122 — platform-side account/page/channel id |
| `external_user_id` | TEXT NULL | mig 0122 — platform-side identity of the human who granted OAuth |
| `external_identity_hash` | TEXT NULL | mig 0122 — `md5(platform || ':' || account_id || ':' || user_id)` |
| `is_personal_mode` | BOOLEAN NOT NULL DEFAULT false | mig 0123 — LinkedIn personal-profile mode |
| `has_emitted_overdue_event` | BOOLEAN NOT NULL DEFAULT false | mig 0123 — idempotency flag for >24h pending_identity banner |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT `now()` | |
| `updated_at` | TIMESTAMPTZ NOT NULL DEFAULT `now()` | |

**Indexes on `social_connections`:**
- `idx_connections_company ON social_connections(company_id)` (mig 0070)
- `idx_connections_status ON social_connections(status)` (mig 0070)
- `idx_social_connections_profile ON social_connections(profile_id) WHERE profile_id IS NOT NULL` (mig 0120)
- `idx_connections_expires_at ON social_connections(expires_at) WHERE expires_at IS NOT NULL` (mig 0110)
- `idx_connections_last_validated_at ON social_connections(last_validated_at) WHERE last_validated_at IS NOT NULL` (mig 0110)
- `social_connections_identity_hash_idx ON social_connections(external_identity_hash) WHERE external_identity_hash IS NOT NULL` (mig 0122)
- `social_connections_external_account_idx ON social_connections(platform, external_account_id) WHERE external_account_id IS NOT NULL` (mig 0122)
- `social_connections_external_user_idx ON social_connections(platform, external_user_id) WHERE external_user_id IS NOT NULL` (mig 0122)
- UNIQUE: `bundle_social_account_id` (mig 0070)

**Related table: `social_connection_alerts`** (mig 0070)

Columns: `id`, `connection_id` FK, `company_id` FK, `severity` (`info|warning|critical`), `message`, `detected_at`, `acknowledged_at`, `acknowledged_by`, `resolved_at`.

**FK relationships:**
- `social_connections.company_id → platform_companies(id)` (CASCADE)
- `social_connections.profile_id → platform_social_profiles(id)` (SET NULL)
- `platform_social_profiles.company_id → platform_companies(id)` (CASCADE)

### TypeScript types

**Primary types file:** `lib/platform/social/connections/types.ts` (lines 1–81)

```ts
export type SocialConnectionStatus =
  | "healthy" | "degraded" | "auth_required" | "disconnected" | "pending_identity";

export type SocialConnection = {
  id: string;
  company_id: string;
  profile_id: string | null;
  platform: SocialPlatform;
  bundle_social_account_id: string;
  display_name: string | null;
  avatar_url: string | null;
  status: SocialConnectionStatus;
  last_error: string | null;
  connected_at: string;
  disconnected_at: string | null;
  last_health_check_at: string;
  external_account_id: string | null;
  external_user_id: string | null;
  external_identity_hash: string | null;
  is_personal_mode: boolean;
  has_emitted_overdue_event: boolean;
  created_at: string;
  updated_at: string;
};
```

Secondary V2 composer type: `lib/social/types.ts:32` — a slimmer `Connection` interface with only `{ id, platform, account_name, account_avatar_url }`, used by the Composer UI layer, not the DB layer.

---

## Q2 — Connection Health / Expiry

### Status and expiry columns

- `status` column: YES — `social_connection_status` enum on `social_connections`.
- `expires_at` column: YES — added by mig `0110`. Nullable; `NULL` means "no expiry info available."
- `last_validated_at` column: YES — added by mig `0110`. Nullable; `NULL` means "never explicitly validated."
- There is NO `token_expires_at` column (distinct from `expires_at`).

### Proactive expiry detection — what exists

**1. Daily health cron:** `app/api/cron/social-connections-health/route.ts`
- Runs at 03:00 UTC daily (Vercel cron).
- Iterates every `platform_companies` row with a non-null `bundle_social_team_id`.
- Calls `syncBundlesocialConnections({ companyId })` for each company.
- The sync calls bundle.social's `teamGetTeam` API, compares remote account status to local rows, and marks rows `disconnected` or `healthy` accordingly.
- After sync: updates `last_health_check_at`. Does NOT proactively check `expires_at < NOW()` and flip to `auth_required` — expiry transition is driven by the webhook arriving or the sync discovering the account is gone.

**2. bundle.social webhooks:** `app/api/webhooks/bundlesocial/route.ts`
- Receives `social-account.auth-required` events → flips row to `auth_required`.
- Receives `social-account.disconnected` → flips to `disconnected`.
- Populates `expires_at` via webhook payload on `social-account.connected` / `updated` (per mig 0110 comment: "populated by the webhook handler (primary path)").

**3. Webhook health cron:** `app/api/cron/check-webhook-health/route.ts`
- Detects silence: if no webhook delivered in 24 hours for an active team → inserts a warning alert in `social_connection_alerts`.

### How would the system know a connection has lapsed TODAY?

The detection path is:
1. **Webhook push (primary):** bundle.social pushes `auth-required` within minutes.
2. **Daily cron (fallback):** If webhook was missed, `social-connections-health` cron reconciles the next morning.
3. **On-demand sync:** Operator can trigger `POST /api/platform/social/connections/sync` from the connections UI.
4. **There is NO scheduled pre-expiry warning check that fires before expiry.** Mig 0110's comment describes an intended "pre-expiry warning query" pattern against `expires_at < NOW() + INTERVAL '7 days'`, and the index exists for it (`idx_connections_expires_at`), but there is no cron route that executes this query and sends notifications.

**Summary:** Expiry detection is reactive (webhook arrival or daily reconcile), not proactive. The pre-expiry warning index exists but no cron fires against it.

---

## Q3 — OAuth Connect/Reconnect Flow

### Where the OAuth flow starts

**Connect route:** `app/api/platform/social/connections/connect/route.ts`

- Method: POST
- Gate: `canDo("manage_connections", company_id)` — admin-only
- Body: `{ company_id: uuid, profile_id: uuid, platform: ProfileSocialPlatform, force_cross_tenant?: boolean }`
- Flow:
  1. `requireCanDoForApi(company_id, "manage_connections")` — session-authenticated admin required
  2. Profile cross-tenant guard: verifies `profile.company_id === company_id` (BSP-10, line 96-106)
  3. L1 pre-connect ghost check: calls `preConnectGhostCheck()` — checks if bundle.social already has an account for this platform on this team
  4. Calls `initiateProfileConnect({ profileId, platform, redirectUrl, disableAutoLogin, withBusinessScope })`
  5. Returns `{ url: string }` — caller opens in popup

The redirect URL is constructed as:
```
${origin}/api/platform/social/connections/callback?company_id=${company_id}&popup=1[&cross_tenant_override=1]
```

There is NO OAuth "state" parameter in the classical sense. The `company_id` binding is passed as a plain query parameter in the redirectUrl when initiating OAuth, and the callback reads it back from the URL. The session cookie provides the user identity (the browser making the callback is the same browser that initiated the connect).

### What is the OAuth state parameter?

There is no bundle.social-level "state" parameter. The binding mechanism is:
- `company_id` in the redirect URL query string
- The authenticated session cookie (the admin who initiates the popup is the same session that lands on the callback)

The cross-tenant binding safeguard is the combination of:
1. The callback calls `requireCanDoForApi(companyId, "manage_connections")` — verifies the session user is an admin of the `company_id` in the URL
2. `syncBundlesocialConnections({ companyId, attributeNewToCompanyId: companyId })` — attributes newly synced accounts to the company whose admin initiated the flow

### Callback route

**`app/api/platform/social/connections/callback/route.ts`** (GET, 505 lines)

Full round-trip:
1. Receives `?company_id=...&popup=1[&cross_tenant_override=1][&success|error=...]`
2. Validates `company_id` as UUID
3. Gates: `requireCanDoForApi(companyId, "manage_connections")` — session cookie checked
4. Classifies URL params (new `?success=<code>` format and old `?<platform>-callback=` format)
5. On error params: returns popup close response or redirect with `?connect=error&reason=...`
6. On success params: calls `syncBundlesocialConnections({ companyId, attributeNewToCompanyId: companyId, forceCrossTenantOverride? })`
7. If `inserted > 0` and `classified.kind === "success"` for a channel-selection platform: looks up the most-recently-inserted `pending_identity` row to surface channel picker
8. Popup response: `postMessage({ type: "bundle-connect-complete", connect: "success|error|noop|needs_channel", ... })` then `window.close()`
9. Non-popup: 302 redirect to `/company/social/connections?connect=...`

### LinkedIn leak fix / cross-tenant binding safeguard

Documented at `docs/incidents/2026-05-11-bundle-social-cross-tenant-leak.md` and `docs/architecture/SOCIAL_CONNECTIONS_IDENTITY_MODEL.md`.

Key code: `lib/platform/social/connections/identity.ts` — `checkCrossTenantConflict()` function, called from `sync.ts` on every insert.

The defence uses `external_identity_hash = md5(platform || ':' || external_account_id || ':' || external_user_id)`. If the hash already exists on a row owned by a different company, the insert is blocked and `cross_tenant_blocked` is emitted to `platform_events`.

### Reconnect flow

**Route:** `app/api/platform/social/connections/reconnect/route.ts`

Gate: `canDo("reconnect_connection", company_id)` — **editor+** (lower permission than connect which requires admin).

Flow:
1. Validates `connection_id` belongs to `company_id` AND has status `auth_required | disconnected`
2. Resolves `profile_id` from the connection row
3. Maps `SocialPlatform → ProfileSocialPlatform` (bundle.social enum)
4. Calls `initiateProfileConnect(...)` — direct OAuth popup, not a hosted-portal link
5. Returns `{ url }` for popup

**There is NO magic-link reconnect flow.** The reconnect is always an interactive OAuth popup requiring an authenticated session. The `platform_session_grants` table (mig 0126) defines a `grant_type IN ('full_session', 'reconnect_only')` column and is described in comments as "for reconnect and approval flows," but no application code reads or writes this table outside integration tests. The table is a **spec schema stub** — it exists in the DB but no route or lib uses it.

---

## Q4 — Client-Facing Connection Access

No non-operator, client-facing route for managing connections exists today.

All connection management routes (`/api/platform/social/connections/*`) require:
- An authenticated Supabase session (middleware enforces this — `/company/*` is not in `PUBLIC_PATHS`)
- `canDo("manage_connections" | "reconnect_connection" | "view_calendar", company_id)` — requires the user to be a `platform_company_users` member of that company

The connections UI page at `app/(platform)/company/social/connections/page.tsx` is behind the platform layout, which requires a logged-in session. There is no token-based, magic-link, or unauthenticated path to the connections management surface.

---

## Q5 — Client-Facing Surfaces (No Account Required)

### /approve/[token]

**File:** `app/approve/[token]/page.tsx`

Public route — no Supabase session required. Token is the auth (64-char hex, SHA-256 hash looked up against `social_approval_recipients.token_hash`).

Renders three states:
1. Invalid/expired/revoked token → "Approval link not valid" panel
2. Token valid, recipient has expired → "Approval window closed" panel
3. Token valid, open → snapshot of post content + `ApprovalDecisionForm`

Paired API: `POST /api/approve/[token]/decision` — also public, token-authenticated, drives the `recordApprovalDecision` lib function.

Both `/approve/` and `/api/approve/` are in middleware's public path list (lines 138-143 of `middleware.ts`).

### /viewer/[token]

**File:** `app/viewer/[token]/page.tsx`

Public route — no Supabase session required. Token is the auth (64-char hex, SHA-256 hash → `social_viewer_links.token_hash`).

Renders a read-only content calendar: 90-day window (60 forward, 30 back) of approved/scheduled/published posts for the company linked to the token. No interactive elements.

Listed in middleware `PUBLIC_PATHS` via the prefix check `pathname.startsWith("/viewer/")` (line 147-148).

### /invite/[token]

**File:** `app/invite/[token]/page.tsx`

Public route — token-authenticated. Hash lookup against `platform_invitations.token_hash`. Renders invite acceptance form (set password, complete name). This is for new platform users being invited to join a company, not client approvers.

Listed in middleware via `pathname.startsWith("/invite/")` (line 129-132).

### /auth/approve

Listed in `PUBLIC_PATHS` explicitly. This is the 2FA email approval landing page, not related to social approvals.

### Routes that skip auth middleware (complete list from middleware.ts lines 58-174)

- `/login`, `/logout`, `/auth-error`
- `/api/emergency`
- `/api/health`
- `/api/debug/env-check`
- `/auth/forgot-password`, `/auth/reset-password`, `/auth/callback`, `/auth/approve`
- `/auth/accept-invite`
- `/design-system`
- `/styles/*`, `/fonts/*`, static asset extensions
- `/api/uat/*`
- `/invite/*`
- `/approve/*`
- `/api/approve/*`
- `/viewer/*`
- `/api/auth/*`
- `/api/cron/*`, `/api/internal/cron/*`
- `/api/internal/image/*`
- `/api/webhooks/*`
- `/api/ops/*`
- `/_next/*`

### Is there a portal concept?

NOT FOUND as a dedicated route or page. The word "portal" appears only in:
- `app/api/platform/social/connections/callback/route.ts:191` — comment referring to bundle.social's "hosted-portal callback" (bundle.social's own OAuth page, not an Opollo portal)
- `app/(platform)/company/social/connections/page.tsx:23` — same "bundle.social hosted-portal callback" reference
- `app/api/platform/companies/switch/route.ts:14` — "company portal renders data" (referring to the company-scoped admin UI, not an external client portal)

No `portal` route directory exists anywhere in `app/`.

---

## Q6 — Company Resolution for External Sessions

### /approve/[token]

**Table:** `social_approval_recipients` (mig 0070, line 453)
- `token_hash TEXT NOT NULL` — raw token hashed with SHA-256 by the route
- `approval_request_id UUID NOT NULL REFERENCES social_approval_requests(id)`

**Resolution chain:**
1. `resolveRecipientByToken(token)` in `lib/platform/social/approvals` (called at `app/approve/[token]/page.tsx:52`)
2. Hashes raw token → looks up `social_approval_recipients.token_hash`
3. Joins to `social_approval_requests` → has `company_id UUID NOT NULL REFERENCES platform_companies(id)` (mig 0070, line 435)
4. Joins to `platform_companies` → returns `company.name`, `company.timezone`

Company is derived from: `token → social_approval_recipients → social_approval_requests.company_id → platform_companies`.

### /viewer/[token]

**Table:** `social_viewer_links` (mig 0070, lines 488-500)
- `token_hash TEXT NOT NULL UNIQUE`
- `company_id UUID NOT NULL REFERENCES platform_companies(id) ON DELETE CASCADE`
- `expires_at TIMESTAMPTZ NOT NULL`, `revoked_at TIMESTAMPTZ`

**Resolution:** `resolveViewerLink(token)` in `lib/platform/social/viewer-links` → hashes token → looks up `social_viewer_links.token_hash` → returns `company.id`, `company.name`, `company.timezone` directly from the row's `company_id`.

---

## Q7 — Major Capability Areas

| Area | Status | Primary files/routes |
|---|---|---|
| **Social posting** | BUILT — production, V2 path active | `app/api/platform/social/posts/`, `app/api/platform/social/drafts/`, `lib/social/types.ts`, `lib/platform/social/posts/` |
| **Image generation** | BUILT — production (Sharp renderer, Bannerbear abandoned 2026-05-29) | `app/api/internal/image/`, `lib/image/`, `supabase/migrations/0159–0171` |
| **Approvals/workflow** | BUILT — production, Phase 2 escalation live | `app/approve/[token]/`, `app/api/approve/[token]/decision/`, `app/api/platform/approvals/callbacks/`, `lib/platform/social/approvals/`, `lib/social/approval/`, `supabase/migrations/0172–0173` |
| **Social connections** | BUILT — production | `app/api/platform/social/connections/`, `lib/platform/social/connections/`, `app/(platform)/company/social/connections/` |
| **Scheduling** | BUILT — QStash + Vercel cron | `app/api/cron/social-connections-health/`, `app/api/webhooks/qstash/social-publish/`, `supabase/migrations/0070 social_schedule_entries` |
| **Email** | BUILT — SendGrid via `dispatch()` | `lib/platform/notifications/dispatch.ts`, `lib/email/sendgrid.ts` |
| **Notifications** | BUILT — in-app rows + email; bell-icon UI deferred | `lib/platform/notifications/`, `platform_notifications` table (mig 0070) |
| **Client access (portal)** | NOT BUILT as a dedicated surface — `/approve/[token]` and `/viewer/[token]` are the only external/client-facing surfaces; no true client portal exists | See Q5 |

---

## Q8 — Recurring Architectural Patterns

### 1. Company scoping / RLS pattern

**Canonical example:** `supabase/migrations/0070_platform_foundation.sql` lines 674–680

```sql
CREATE POLICY connections_access ON social_connections FOR ALL
  USING (is_opollo_staff() OR is_company_member(company_id))
  WITH CHECK (is_opollo_staff() OR is_company_member(company_id));
```

The helper functions `is_opollo_staff()`, `is_company_member(UUID)`, `has_company_role(UUID, role)`, and `current_user_company()` are all defined in mig 0070 (lines 317-343) and re-used across all RLS policies. Every platform table uses `is_company_member(company_id)` for read access and `has_company_role(company_id, 'admin')` for write gates.

### 2. Magic-link / token handling — canonical example

**Canonical example:** `app/invite/[token]/page.tsx` (lines 1–48 for the pattern)

Pattern:
1. Raw token in URL path param
2. `createHash("sha256").update(rawToken).digest("hex")` → `tokenHash`
3. Service-role client: `.from("table").select(...).eq("token_hash", tokenHash).maybeSingle()`
4. Validate state: not null, not expired, not revoked
5. Render or reject

The same pattern is used in:
- `app/approve/[token]/page.tsx` → `resolveRecipientByToken(token)` in lib
- `app/viewer/[token]/page.tsx` → `resolveViewerLink(token)` in lib
- `app/auth/approve/page.tsx` → 2FA approval tokens in `login_challenges`

### 3. QStash for delayed work — canonical example

**Canonical example:** `app/api/webhooks/qstash/social-publish/route.ts`

Pattern:
1. Route verifies `verifyQstashSignature({ signature: req.headers.get("upstash-signature"), rawBody })`
2. `export const runtime = "nodejs"; export const dynamic = "force-dynamic";`
3. Parse body with Zod schema
4. Execute the work
5. Return `200` for all successful outcomes including no-ops (to stop QStash retries); return `500` for transient failures (QStash will retry)

QStash messages are enqueued from schedule-creation code in lib, with `scheduleEntryId` as body payload.

### 4. dispatch() for email — canonical definition and usage

**Definition:** `lib/platform/notifications/dispatch.ts:40` — `export async function dispatch(payload: DispatchPayload): Promise<DispatchResult>`

**Export barrel:** `lib/platform/notifications/index.ts:1` — `export { dispatch } from "./dispatch";`

**Canonical usage:** `app/api/approve/[token]/decision/route.ts` lines ~155–175:
```ts
await dispatch({
  event: "approval_decided",
  companyId,
  postMasterId: result.data.postId,
  submitterUserId: createdBy,
  decision: parsed.data.decision,
});
```

`dispatch()` resolves recipients per event type (from `EVENT_CHANNELS` map), fans out to email (SendGrid) and in-app rows (`platform_notifications`), and never throws.

### 5. Route / auth / Zod / envelope convention — canonical route handler

**Canonical example:** `app/api/platform/social/connections/connect/route.ts` (full file)

Pattern:
```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ ... });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJsonBody(req);
  if (body === undefined) return validationError("...");
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return validationError("...", { issues: parsed.error.issues });

  const gate = await requireCanDoForApi(parsed.data.company_id, "permission_name");
  if (gate.kind === "deny") return gate.response;

  // ... business logic ...

  return NextResponse.json(
    { ok: true, data: { ... }, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
```

Success envelope: `{ ok: true, data: {...}, timestamp: ISO }`. Error helpers: `validationError()`, `notFound()`, `invalidState()`, `internalError()`, `respond()` from `lib/http.ts`.

### 6. V2-not-V1 pipeline for social posts

**What makes something "V2":**

V1 = `social_post_master` / `social_post_variant` tables (mig 0070). State machine on `social_post_master.state`.

V2 = `social_post_drafts` table (mig 0112). Introduced by the Composer v3 rebuild.

**Key differences:**
- V2 uses `draft_data JSONB` for full draft payload including `target_profiles` array (connection-to-profile mapping), whereas V1 uses explicit `social_post_variant` rows per platform.
- V2 `social_post_drafts` has a `draft_version INT` for optimistic concurrency (CAS).
- V2 drafts carry `target_profiles: Array<{ profile_id: string, platform: string }>` in the draft_data or as a column.
- The V2 publish path: `lib/social/publishing/claim-due-drafts.ts` + `lib/social/publishing/bundle-social-client.ts`

**Canonical file for V2:** `lib/social/types.ts` — the `Draft`, `Connection`, and `DraftState` types that the Composer UI uses. The lib comment explicitly states: "Existing publishing layer types remain in `lib/platform/social/`. Both coexist during cutover."

V2 routes under `app/api/platform/social/drafts/` write to `social_post_drafts` (V2 table). Routes under `app/api/platform/social/posts/` use the legacy V1 path (`social_post_master`) for reads, with POST now writing to `social_post_drafts` (per route comment: "PR-07 V1→V2 migration").

---

## Q9 — Existing Docs

### docs/architecture/

| File | Covers |
|---|---|
| `ARCHITECTURE.md` | High-level overview |
| `AUTH.md` | All auth flows: login, forgot-password, reset-password, 2FA, invite redemption; flow diagrams |
| `BUILD.md` | Build setup, CI configuration |
| `BUNDLE_SOCIAL_THEMING.md` | bundle.social UI/theme customisation |
| `CONTEXT.md` | M12/M13 context anchor (brief-driven page generation, blog generation) |
| `CRITICAL_PATHS.md` | Enumeration of production-critical routes (auth, social, multi-tenant, encryption, migrations, brief generation) |
| `DATA_CONVENTIONS.md` | Data and AI conventions |
| `DESIGN_SYSTEM.md` | Design system architecture (current, soft-light theme) |
| `ENGINEERING_STANDARDS.md` | Coding standards |
| `NAVIGATION.md` | Two-level rail + section panel navigation architecture |
| `OBSERVABILITY.md` | Observability + security contract |
| `OPTIMISER.md` | Optimiser module architecture |
| `PERFORMANCE.md` | Performance standards |
| `PROMPT_VERSIONING.md` | Prompt versioning conventions |
| `RULES.md` | Incident-derived rules registry (13 rules as of recon date) |
| `SOCIAL_CONNECTIONS_IDENTITY_MODEL.md` | Full identity model + cross-tenant leak defence (6 layers); webhook coverage table; operator runbook |

### docs/governance/

| File | Covers |
|---|---|
| `DX_HYGIENE.md` | Hooks, commitlint, supply-chain scans |
| `MERGE_RULES.md` | Full merge rules |
| `PARALLELISM.md` | Parallel session protocol |
| `README.md` | Governance index |
| `RELEASE_HYGIENE.md` | Release-please, changelog |

### docs/patterns/

| File | Covers |
|---|---|
| `README.md` | Patterns index |
| `assistive-operator-flow.md` | Operator-facing AI assist flows |
| `background-worker-with-write-safety.md` | Background worker + write-safety pattern |
| `brief-driven-generation.md` | Brief-driven page generation pattern |
| `component-hook-test.md` | Component + hook test pattern |
| `concurrency-test-harness.md` | Concurrency testing |
| `extract-design-system.md` | Design system extraction |
| `feature-flagged-rollout.md` | Feature flag rollout |
| `icons.md` | Icon usage |
| `new-admin-page.md` | New admin page scaffold |
| `new-api-route.md` | New API route scaffold (canonical route handler shape) |
| `new-batch-worker-stage.md` | New batch worker stage |
| `new-migration.md` | New migration scaffold |
| `page-document-generator.md` | Page/document generator |
| `playwright-e2e-coverage.md` | Playwright E2E coverage |
| `pure-unit-test.md` | Pure unit test scaffold |
| `quality-gate-runner.md` | Quality gate runner |
| `rls-policy-test-matrix.md` | RLS policy test matrix |
| `ship-sub-slice.md` | Sub-slice shipping checklist |
| `site-graph.md` | Site graph pattern |
| `visual-regression-screenshots.md` | Visual regression screenshots |

### Is there a RULES.md?

YES — `docs/architecture/RULES.md`. Contains 13 incident-derived rules covering: test helper hygiene, email auth for fresh stacks, CI stuck-run recovery, write-safety audit mandate, UX debt capture, ADD COLUMN backfill requirement, typography minimums, static audit HIGH gate, env-var echo prevention, PageHeader primitive mandate, breadcrumb requirement, raw h1 prohibition, DataTable mandate.

### Gaps relevant to Brief 4 (client portal) work

The following areas relevant to a client portal are NOT documented:

1. **No portal architecture doc** — no `docs/architecture/PORTAL.md` or similar. The concept doesn't exist in the codebase yet.
2. **No pattern for unauthenticated-session-with-company-context** — the current magic-link pattern for `/approve/[token]` resolves company from a token but doesn't establish a persistent session. A client portal requiring multiple page views would need a new pattern (session grants table exists in schema but has no application code using it).
3. **`platform_session_grants` is a schema stub** — mig 0126 created the table with `grant_type IN ('full_session', 'reconnect_only')`, described in the comment as "for reconnect and approval flows," but no lib code reads or writes it beyond integration tests. This is the designed home for portal session management but is completely unimplemented.
4. **No connection-management surface for non-admin users** — all connection actions require admin role. A client portal would need a lowered-permission path for reconnecting their own connections.
5. **No notification path for "your connection needs reauth" sent to client** — the current `dispatch()` events include `connection_lost`/`connection_restored` in `platform_notification_type`, but the routing in `dispatch.ts` resolves recipients as company admins + Opollo admins, not as external clients.

---

## Contradictions — Brief 4 Assumptions

### "Magic-link reconnect is greenfield"

**PARTIALLY TRUE, PARTIALLY CONTRADICTED.**

The `platform_session_grants` table (mig `0126_reliability_and_cap_foundations.sql:265-296`) was designed and schemaed for exactly this purpose — it has `grant_type IN ('full_session', 'reconnect_only')`, `scope_connection_id UUID REFERENCES social_connections(id)`, `token_hash TEXT NOT NULL UNIQUE`, `second_factor_required BOOLEAN`, `expires_at TIMESTAMPTZ`, and is commented as "Single-use magic-link tokens for reconnect and approval flows."

However, **no application code implements this table**. Searches across `lib/` and `app/` for `platform_session_grants` return only integration test references (`lib/__tests__/migration-0126-reliability-cap-foundations.test.ts`). The schema is greenfield from an implementation standpoint, but the data model is already designed and committed.

Brief 4 should build on `platform_session_grants` rather than inventing a new table.

### "No expiry detection exists"

**PARTIALLY CONTRADICTED.**

Two mechanisms exist:
1. `social_connections.expires_at` column (mig 0110) — populated by webhooks.
2. `app/api/cron/social-connections-health/route.ts` — daily cron that syncs bundle.social state and would mark connections `auth_required` if bundle.social reports them so.

However, the Brief 4 assumption is correct that **proactive pre-expiry warning does not exist**. The `idx_connections_expires_at` index (mig 0110) was created explicitly "for the pre-expiry warning cron query" but the cron route that would use it was never built. There is no mechanism today that says "connection expires in 7 days, email the client."

For Brief 4, proactive detection against `expires_at < NOW() + INTERVAL '7 days'` is genuinely greenfield — the index exists, the column exists, the cron shell is missing.

### "Client portal is a new separate surface"

**CONFIRMED — the client portal is genuinely new.**

There is no client portal surface. What exists is limited to:
- `/approve/[token]` — single-page approval decision (no session, no multi-page navigation, no connection management)
- `/viewer/[token]` — single-page read-only calendar (no session, no interactive elements)
- `/invite/[token]` — invite redemption (creates a new platform_company_users member — a different concept)

None of these surfaces allows a client to:
- See their connection health
- Trigger a reconnect
- Have a persistent session without becoming a full platform user

The client portal concept — a persistent, magic-link-gated session for a client to manage their own connections — is genuinely absent from the codebase. The schema stub in `platform_session_grants` is the closest evidence of prior design intent, but the application layer is a blank slate.

---

## Key File Index

| File | Role |
|---|---|
| `supabase/migrations/0070_platform_foundation.sql` | Creates all core social tables including `social_connections`, `social_approval_requests/recipients`, `social_viewer_links` |
| `supabase/migrations/0110_social_connections_expiry.sql` | Adds `expires_at`, `last_validated_at` to `social_connections` |
| `supabase/migrations/0118_platform_social_profiles.sql` | Creates `platform_social_profiles`; per-profile bundle.social team isolation |
| `supabase/migrations/0122_social_connections_identity_fingerprints.sql` | Cross-tenant identity defence columns + `pending_identity` status |
| `supabase/migrations/0126_reliability_and_cap_foundations.sql` | `platform_session_grants` table (reconnect magic link schema, unimplemented) |
| `lib/platform/social/connections/types.ts` | `SocialConnection` TypeScript type + status enum |
| `lib/platform/social/connections/sync.ts` | `syncBundlesocialConnections()` — the core sync function |
| `lib/platform/social/connections/identity.ts` | Cross-tenant conflict detection |
| `lib/platform/notifications/dispatch.ts` | `dispatch()` — canonical notification fanout |
| `app/api/platform/social/connections/connect/route.ts` | OAuth initiation (admin-gated) |
| `app/api/platform/social/connections/callback/route.ts` | OAuth callback — company binding, sync trigger |
| `app/api/platform/social/connections/reconnect/route.ts` | Self-service reconnect (editor+ gated) |
| `app/api/cron/social-connections-health/route.ts` | Daily health cron |
| `app/api/webhooks/bundlesocial/route.ts` | bundle.social inbound webhooks |
| `app/approve/[token]/page.tsx` | External approval viewer (no session required) |
| `app/viewer/[token]/page.tsx` | External read-only calendar (no session required) |
| `app/invite/[token]/page.tsx` | Canonical magic-link token resolution pattern |
| `middleware.ts` | All public path exemptions (lines 58-174) |
| `docs/architecture/SOCIAL_CONNECTIONS_IDENTITY_MODEL.md` | Full identity model + cross-tenant defence documentation |
| `docs/architecture/RULES.md` | Incident-derived rules |
