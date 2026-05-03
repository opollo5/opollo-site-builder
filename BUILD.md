# Opollo Site Builder — Platform & Social Module BUILD.md

> **This is the operational doc for Claude Code.** Read this first before working on anything in `/platform/*` or `/social/*` or `/image/*`.
> Read ARCHITECTURE.md second — it tells you what's load-bearing in the existing codebase and what you must not touch.
> The full proposals live at `docs/`. Trust this doc for execution.

---

## What you are building

Three layers added on top of the existing Opollo Site Builder:

**1. Platform Layer** — Customer company management: companies, brand profiles, product subscriptions, users, roles, invitations, notifications. Used by every Opollo product. Sits alongside (not inside) the existing operator layer (`opollo_users`).

**2. N-Series (Social Module)** — Social media scheduling and approval. MSPs draft posts → approvers review → posts schedule → bundle.social publishes.

**3. Image Generation** — Ideogram background generation + programmatic text/logo compositing via Bannerbear or Placid.

**The existing codebase is operationally hot.** It runs real Anthropic money on real client WordPress sites. Do not touch anything in `lib/brief-runner.ts`, `lib/batch-worker.ts`, `lib/db-direct.ts`, `lib/encryption.ts`, `lib/2fa/*`, `lib/security-headers.ts`, or any landed migration without explicit approval. Read ARCHITECTURE.md §18 before proposing any refactor.

---

## Two separate user systems — do not blur

```
Existing: opollo_users (operators)
  super_admin / admin / user
  → access /admin/* routes
  → managed by existing auth gates (checkAdminAccess / requireAdminForApi)

New: platform_users (customer users)
  admin / approver / editor / viewer  (roles within one company)
  → access /customer/* routes (customer-facing)
  → Opollo staff access /admin/platform/* (operator view of customer data)
  → managed by requireCompanyContext() sitting BEHIND the existing auth gate
```

**Critical:** customer user auth and operator auth are separate systems. `platform_users` extends `auth.users` (Supabase). `opollo_users` is a separate table. Never conflate them.

---

## Authentication model

| Action | Auth required |
|--------|---------------|
| Customer logs into platform | Email + password (Supabase Auth) |
| Customer approves content via email | Magic link (scoped, no session) |
| Customer views read-only calendar | Magic link (scoped, no session) |
| Customer edits brand profile | Logged in (password auth) |
| Opollo staff manages customer companies | Logged in as operator + existing admin gate |
| Social account connections | Logged in as customer Admin |
| Invite acceptance (first login) | Magic link → set password → standard session |

Magic links never grant access to settings, brand profile, or management. Scoped to one approval or one read-only view.

---

## Current state

- **Slice in progress:** S7 (bulk CSV upload — 100 rows/upload, 3 uploads/hour/company, rate-limited)
- **Most recently shipped:** S1-18 publish pipeline (#439) + S1-17 inbound webhook handler (#437)
- **S0 (bundle.social verification):** complete
- **Vendor confirmed:** bundle.social (publishing), Ideogram (backgrounds), Bannerbear or Placid (compositing — evaluate at I2)

> **Slice numbering note.** Phase B shipped under the `S1-N` sub-slice convention (`feat(s1-1)` … `feat(s1-18)`), not the `S1` … `S8` parent labels in the build sequence below. The Phase B table maps each parent slice to the sub-slice PRs that delivered it; reference those PRs (and `git log main --grep "feat(s1-"`) for the actual implementation history.

---

## Build sequence

### Phase A: Platform Layer

| Slice | Scope | Status |
|-------|-------|--------|
| P1 | Schema, RLS, auth helpers | ✅ Shipped (#376 migration 0070; #435 migration 0074 audit cols + brand governance + image-gen log + version_lock + soft-delete + `_active` views) |
| P2 | Invitation flow (send, accept, set password) | ✅ Shipped (P2-1 #378 auth helpers; P2-2 #380 send/revoke; P2-3 #385 accept; #388 accept-page follow-up; P2-4 #403 reminder + expiry callbacks) |
| P3 | Opollo staff view: `/admin/platform/companies` (list, create, brand overview) | ✅ Shipped (P3-1 #387 list; P3-2 #391 create; P3-3 #393 detail; P3-4 #395 invite-from-detail) |
| P4 | Customer admin: `/company/users` (invite, manage roles) | ✅ Shipped (#397). **Route note:** customer surface lives under `/company/*`, not `/customer/*` as originally drafted — the rest of this doc still says `/customer/...` in places; treat those as `/company/...` until a future cleanup unifies the prose. |
| P5 | Notification system (email + in-app foundation) | ✅ Shipped (#399 dispatcher) |
| P-Brand-1 | Brand profile editor: `/company/settings/brand` (visual identity + tone + content rules + version history) | ✅ Shipped (P-Brand-1a/1b/1c #448 editor + API + landing integration; P-Brand-1d #453 E2E helper + spec) |
| P-Brand-2 | Brand helper functions: `get_active_brand_profile()`, `can_access_product()`, completion tier logic | ✅ Shipped: DB helpers in #435; `getBrandTier()` + tier label/description in `lib/platform/brand/completion.ts` (P-Brand-1c). |

> **Original BUILD.md said P-Brand-1/2 must complete before S1.** That dependency didn't materialise — `social_post_master.brand_profile_id` is nullable (FK added in #435), so the social slices shipped without an active brand profile. P-Brand-1 now unblocks brand-stamp behaviour at composer time + Phase C image generation.

### Phase B: Social Module (N-Series)

| Slice | Scope | Status |
|-------|-------|--------|
| S1 | Social schema + RLS | ✅ Shipped (in #376 migration 0070 + #435 migration 0074 audit/brand additions) |
| S2 | Connection flow + admin alerting | ✅ Shipped via S1-12 (#424 list page), S1-13 (#426 SDK + foundation), S1-16 (#434 hosted-portal connect flow), S1-17 (#437 inbound webhook handler with HMAC verification). Admin-alerting surface piggybacks on existing operator surfaces. |
| S3 | Composer (post_master with brand stamp, variants, media, sync/decouple) | ✅ Shipped via S1-1 (#405 lib), S1-2 (#406 HTTP API + customer list), S1-3 (#408 detail/edit/delete), S1-4 (#410 per-platform variants). **Brand stamp** (writing `brand_profile_id` + `brand_profile_version` on submit) lands when P-Brand-1 ships an active profile to read. |
| S4 | Magic-link approval (snapshots, tokens, review UI, in-app for platform users) | ✅ Shipped via S1-5 (#412 submit), S1-6 (#414 recipients + email), S1-7 (#415 magic-link viewer + transactional decision), S1-8 (#417 decision notifications + audit), S1-9 (#418 reopen-for-editing), S1-10 (#420 cancel-approval) |
| S5 | Scheduling + publishing + reliability (QStash, retries, watchdog, reconciliation) | ✅ Shipped via S1-14 (#428 schedule entries L3) + S1-18 (#439 publish pipeline: QStash → claim_publish_job RPC → bundle.social). Watchdog/reconciliation cron(s) ride on existing `/api/cron/*` infra. |
| S6 | Customer read-only calendar | ✅ Shipped via S1-15 (#431 viewer-link magic-link, 90-day customer calendar) |
| S7 | Bulk CSV upload | 👈 Current |
| S8 | Self-service connection reconnect | ❌ Pending. Adjacent to S2 — operator-driven reconnect already works via the connect-portal; customer-driven self-service is the remaining gap. |

### Phase C: Image Generation

| Slice | Scope | Status |
|-------|-------|--------|
| I1 | Ideogram client (backgrounds only, GLOBAL_NEGATIVE_PROMPT). Prompt engine (parameterised). Brand profile reader. Standard/premium routing. Stock fallback. image_generation_log writes. | ✅ Shipped (#455) |
| I2 | Evaluate Bannerbear vs Placid against 3 real client templates. Implement compositeImage() interface + winning provider. Text zones + logo positions. | ✅ Shipped (#457 Bannerbear primary, Placid stub, TEXT_ZONE_MAP pixel conversion) |
| I3 | Failure handler: luminance check + safe zone check → retry → stock fallback → escalation. Quality check rules. | ✅ Shipped (#459) |
| I4 | Mood board UI: style selector, composition selector, 4–6 results, 1-click select. | ✅ Shipped (#463) |
| I5 | CAP Phase 2: automated generation via source_type='cap' (Phase 2) | ❌ Pending (Phase 2 — see "What is NOT V1" further down) |

**Rule:** finish one slice, CI green, PR merged, before starting the next.

> **Status reconciliation history.** This table was reconciled against actual `git log main` on 2026-05-03 (PR #X). Phase A/B status fields had drifted from reality during the P1 → S1-18 sprint. Going forward, BUILD.md status updates ride alongside slice merges (each slice's PR description includes the row update); a periodic full reconciliation runs when drift exceeds 2-3 slices.

---

## Route structure

```
app/
├── admin/                          ← EXISTING operator routes (do not move)
│   ├── platform/                   ← NEW: Opollo staff managing customer companies
│   │   ├── companies/              ← list, create, brand overview, product subscriptions
│   │   └── companies/[id]/         ← company detail, brand, social settings
│   └── [existing routes unchanged]
├── customer/                       ← NEW: customer-facing (different layout shell, different gate)
│   ├── layout.tsx                  ← customer chrome (no admin sidebar)
│   ├── dashboard/                  ← company overview, brand completion prompt
│   ├── settings/
│   │   ├── brand/                  ← brand profile editor
│   │   └── users/                  ← invite + manage team
│   ├── social/
│   │   ├── calendar/               ← read-only calendar (magic link or logged-in)
│   │   └── posts/                  ← compose, approve, schedule
│   └── image/                      ← mood board generation UI
├── review/[token]/                 ← magic-link approval (no auth session, scoped token)
├── calendar/[token]/               ← magic-link read-only calendar
├── invite/[token]/                 ← invitation acceptance
└── api/
    ├── platform/                   ← platform API routes
    ├── social/                     ← social API routes
    ├── image/                      ← image generation API routes
    └── webhooks/bundle-social/     ← bundle.social webhook receiver
```

**Critical:** `/customer/*` uses a different layout shell and auth gate from `/admin/*`. Middleware must apply different policy to each prefix. Do NOT bolt customer auth onto existing `/admin/*` routes.

---

## Code patterns — match the existing codebase

### Database access (per ARCHITECTURE.md §6)

```typescript
// For API routes: PostgREST via service role (bypasses RLS)
import { getServiceRoleClient } from '@/lib/supabase';
const supabase = getServiceRoleClient();

// For workers that need SKIP LOCKED / multi-statement transactions:
import { requireDbConfig } from '@/lib/db-direct';
const db = await requireDbConfig();  // direct pg.Client — do NOT use connectionString directly
```

Never construct `new pg.Client({ connectionString })` — use `requireDbConfig()` from `lib/db-direct.ts`. This is the fix for the Vercel runtime `ENOTFOUND base` bug.

### Optimistic concurrency (version_lock)

Every mutation on a long-lived row must use the version_lock pattern:

```typescript
const { data, error } = await supabase
  .from('social_post_master')
  .update({ state: 'approved', version_lock: current.version_lock + 1, updated_by: userId })
  .eq('id', postId)
  .eq('version_lock', current.version_lock)
  .select()
  .single();

if (!data) {
  // Zero rows = VERSION_CONFLICT — return 409
  return NextResponse.json({ error: 'VERSION_CONFLICT' }, { status: 409 });
}
// Client refreshes and retries on 409
```

### Soft delete

```typescript
// Soft-delete (never hard-delete operator-visible entities)
await supabase
  .from('platform_company_users')
  .update({ deleted_at: new Date().toISOString(), deleted_by: actorId, version_lock: current.version_lock + 1 })
  .eq('id', membershipId)
  .eq('version_lock', current.version_lock);

// Always query _active views or add WHERE deleted_at IS NULL
const { data } = await supabase
  .from('platform_companies_active')  // use the _active view
  .select('*')
  .eq('id', companyId)
  .single();
```

### Logging — NEVER use console.log in prod paths

```typescript
// ✅ CORRECT — always use lib/logger.ts
import { logger } from '@/lib/logger';

logger.info('Post submitted for approval', { postId, companyId, requestId });
logger.error('Image generation failed', { error, styleId, companyId });

// ❌ WRONG — blocked by audit:static
console.log('...');
console.error('...');
```

The logger reads `x-request-id` from AsyncLocalStorage automatically. Every HTTP response must carry `x-request-id` (middleware handles this for existing routes — follow the same pattern for new routes).

### Email — NEVER import @sendgrid/mail directly

```typescript
// ✅ CORRECT — only path allowed per ARCHITECTURE.md §8
// Route → dispatch() → lib/email/sendgrid.ts → SendGrid
import { dispatch } from '@/lib/platform/notifications/dispatch';

await dispatch('approval_requested', [
  { userId: approver.id, email: approver.email },
], { postId, postTitle, reviewUrl });

// ❌ WRONG — code-review block
import sgMail from '@sendgrid/mail';
```

`lib/email/sendgrid.ts` and `lib/email/templates/base.ts` are the ONLY files that may import `@sendgrid/mail`. Every send writes to `platform_email_log`.

### Auth gate layering

For Opollo staff accessing customer company data via `/admin/platform/*`:

```typescript
// app/admin/platform/companies/[companyId]/route.ts
import { requireAdminForApi } from '@/lib/admin-api-gate';  // existing gate
import { requireCompanyContext } from '@/lib/platform/auth/company-context';

export async function GET(req: Request, { params }: { params: { companyId: string } }) {
  // 1. Existing operator auth gate (must pass first)
  const { user: operatorUser } = await requireAdminForApi(req);

  // 2. Company context resolution (our new gate)
  const { companyId } = await requireCompanyContext(params.companyId);

  // companyId is guaranteed valid for the current operator from here
}
```

For customer-facing routes under `/customer/*`, use a separate customer auth middleware — do not reuse `checkAdminAccess` / `requireAdminForApi`.

### CSP — new external domains need allowlisting

When adding any new external API call, add the domain to `lib/security-headers.ts` `connect-src`:

```typescript
// Domains to add for this build:
// api.ideogram.ai         — Ideogram API
// api.bannerbear.com      — Bannerbear (if selected)
// api.placid.app          — Placid (if selected)
// mcp.bundle.social       — bundle.social (if not already present)
```

The static audit (`npm run audit:static`) checks CSP coverage. Missing entries block CI.

---

## Image generation — non-negotiable rules

Read the image-generation skill before touching anything in `lib/image/`.

1. **Background only.** No text in Ideogram prompts. GLOBAL_NEGATIVE_PROMPT enforces this at the API level.
2. **Parameterised prompts.** No free-form input. style_id + primary_colour + composition_type → prompt. No text field exposed to users.
3. **Composition→text zone is deterministic.** The composition type dictates exactly where the text zone sits. See image-generation skill for the full mapping table.
4. **Brand from brand profile.** `get_active_brand_profile(companyId)` — never pass brand config ad-hoc.
5. **Every call writes to image_generation_log.** No exceptions. Include prompt, model, outcome, fallback, quality scores.
6. **compositeImage() is the only compositing call.** Never call Bannerbear or Placid directly from product code.
7. **Quality check before showing to user.** Luminance check + safe zone check + dimension check. See image-generation skill.
8. **Failure handler on every generation.** quality fail → retry once → stock fallback → escalate. Never surface raw failure.
9. **safe_mode disables styles.** When safe_mode=true, `bold_promo` and `editorial` are blocked entirely in the UI. Only `clean_corporate`, `minimal_modern`, `product_focus` available.
10. **Store in Supabase Storage.** Download Ideogram output immediately. Never use Ideogram URLs long-term (ephemeral).

---

## Do not ask, just do this

### Vendors (locked)
- **Auth:** Supabase Auth (email + password)
- **Publishing:** bundle.social
- **Image generation:** Ideogram (backgrounds only)
- **Compositing:** Bannerbear or Placid (evaluate at I2, commit to one, implement interface)
- **Email:** SendGrid via `lib/email/sendgrid.ts` exclusively
- **Queue:** Upstash QStash
- **Storage:** Supabase Storage

### Defaults (locked)
- Approval token expiry: 14 days
- Calendar viewer link expiry: 90 days
- Invitation expiry: 14 days (reminder day 3, expiry notice day 14)
- Publish window tolerance: ±2 minutes
- Bulk CSV: 100 rows per upload, 3 uploads/hour/company
- Concurrent publishes: 5 per company (database-count check at L4)
- Watchdog timeout: 3 minutes
- Reconciliation sweep: every 5 minutes
- Image retry: 1 automatic retry, then stock fallback
- Ideogram standard: 3.0 Flash (`ideogram-ai/ideogram-v3-flash`)
- Ideogram premium: 3.0 Default (`ideogram-ai/ideogram-v3`)
- Image timeout: 30 seconds
- Mood board options: 4–6 per request
- version_lock conflict response: HTTP 409 with body `{ error: 'VERSION_CONFLICT' }`

### Branding
- Primary: `#FF03A5`
- Green: `#00E5A0`
- Font: EmBauhausW00
- Min font size: 16px (`text-base`). `text-xs` is forbidden (overridden to 15px globally).

---

## When in doubt

1. Check `docs/social-module-decisions.md`
2. Check the relevant skill in `.claude/skills/`
3. Check `ARCHITECTURE.md` — if you're touching something that feels load-bearing, it probably is
4. Default to more validation, more idempotency, more audit logging
5. Only ask Steven for strategic decisions he can uniquely make

---

## What is NOT V1

- AI writing assistants / CAP automated copy (Phase 2)
- Analytics dashboards (Phase 2)
- Multi-company users (one company per user in V1)
- SSO (email + password only)
- Two-factor auth for customer users (Phase 2)
- Facebook personal profiles (Meta API restriction)
- LinkedIn document posts, X long-form, GBP product posts (bundle.social gap)
- Slack/Teams notifications (Phase 1.5)
- Connection sweep cron (deferred)
- Custom Ideogram model training (requires 1M images/month minimum)
- Free-form image prompting (never — parameterised only)
- Text baked into AI-generated images (never — compositing layer only)

---

## Skills reference

| When working on… | Read skill |
|------------------|-----------|
| Companies, users, invitations, notifications, auth | `platform-customer-management` |
| Brand profiles, product subscriptions | `platform-brand-governance` |
| Social layer architecture (L1–L7 rules) | `n-series-layer-rules` |
| bundle.social, webhooks, publishing, retries | `bundle-social-integration` |
| Approval tokens, snapshots, state machine | `approval-workflow-patterns` |
| Ideogram, compositing, quality checks, failure handling | `image-generation` |
