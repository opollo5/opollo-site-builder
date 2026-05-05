# Architecture Brief — read before proposing structural changes

**Audience:** anyone (Claude, ChatGPT, a new contributor) about to refactor or extend this codebase. This doc tells you what's load-bearing, what's intentionally weird, and what to leave alone.

**Companion docs:**
- [`CLAUDE.md`](../CLAUDE.md) — "how to work in this repo" (commit style, PR cadence, autonomy rules). Read second.
- [`docs/RUNBOOK.md`](./RUNBOOK.md) — operator playbook for incidents (rotate keys, recover stuck queues, etc.).
- [`docs/DATA_CONVENTIONS.md`](./DATA_CONVENTIONS.md) — column conventions (`deleted_at`, `version_lock`, audit cols).
- [`docs/PROMPT_VERSIONING.md`](./PROMPT_VERSIONING.md) — how prompts evolve (versioned dirs, eval harness).

If you're proposing a refactor: read this top to bottom first. The "Load-bearing rails" section is the failure-mode cheat-sheet — most refactor proposals that would break the system trip on something listed there.

---

## 1. What this is in one paragraph

Next.js 14 (App Router) + TypeScript + Supabase admin tool that generates WordPress pages and posts via the Anthropic SDK. Operators upload briefs, the system parses them into pages, runs Claude through a pass-loop (anchor → revise → visual-critique cycles) per page, surfaces drafts for human approval, and publishes the approved pages to a WordPress site via REST. There's a separate **Optimiser** module (under `feat/optimiser`) that analyses Google Ads landing pages and proposes optimisations — it's strictly namespaced and does not share runtime code with the page-builder side.

---

## 2. The two domains — never blur the boundary

```
opollo-site-builder/
├── app/admin/                 ← page-builder admin UI
├── app/api/                   ← page-builder + shared API routes
├── app/optimiser/             ← optimiser admin UI (NEVER touched by builder)
├── app/api/optimiser/         ← optimiser API routes
├── app/api/cron/optimiser-*   ← optimiser scheduled jobs
├── lib/                       ← page-builder runtime + shared utilities
├── lib/optimiser/             ← optimiser runtime (never imported from builder)
├── components/                ← page-builder UI
├── components/optimiser/      ← optimiser UI
├── skills/optimiser/          ← optimiser-specific operator skills
└── supabase/migrations/       ← unified migration stream (numbered sequentially)
```

**Hard rule** (per `CLAUDE.md` Optimiser section): the optimiser module reuses inherited surfaces — auth (Supabase + role gates), the page-builder generation engine, `site_conventions`, the WordPress connector (indirectly), the cron runner, and the email provider — but does not duplicate them. Tables it owns are prefixed `opt_*`. Routes are under `/optimiser` and `/api/optimiser`. The page-builder side does not import from `lib/optimiser/*`.

If you're refactoring the page-builder, **stay out of `lib/optimiser/`, `app/optimiser/`, and `app/api/optimiser/`**. If you're refactoring the optimiser, **don't touch builder-side files** — the only allowed crossover is `CLAUDE.md` updates.

---

## 3. Auth architecture (load-bearing — every protected route depends on this)

### 3.1 Three layers

```
Request
  ↓
1. middleware.ts                        ← FEATURE_SUPABASE_AUTH gate, security headers
  ↓
2. checkAdminAccess() / requireAdminForApi()   ← role gate, runs in route handlers
  ↓
3. RLS policies (Supabase)              ← row-level enforcement, defence in depth
```

### 3.2 Role tiers

`opollo_users.role` enum:
- `super_admin` — root operator (sees Audit log, Email test, System jobs, Users management with all roles)
- `admin` — trusted operator (sees Users management with admin/user roles only; no super_admin sub-tools)
- `user` — read-only / limited surfaces

Migration `0057_auth_role_collapse.sql` mapped legacy `viewer` → `user` and `operator` → `admin`. Never reintroduce the legacy values.

### 3.3 Kill switches

- `FEATURE_SUPABASE_AUTH` env flag — when unset/false, `checkAdminAccess` returns `{kind:"allow", user:null}`. Basic Auth (`BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD`) still gates the deployment. Used during early dev.
- Auth kill switch via `is_auth_kill_switch_on()` SQL helper — stored DB flag. Same effect as `FEATURE_SUPABASE_AUTH` off but flippable without redeploy. Reserved for emergency.

When proposing auth changes: never remove the FEATURE flag pathway without removing every `if (!isSupabaseAuthOn())` branch in `lib/admin-gate.ts` and tests. Lots of UAT scenarios assume the flag-off path keeps working.

### 3.4 2FA email-approval flow

Optional second factor gated on `AUTH_2FA_ENABLED=true`:
1. Operator submits `/login` form → server creates `login_challenges` row + signs `opollo_pending_2fa` cookie + signs `opollo_pending_device_id` cookie + sends approval email via SendGrid → redirects to `/login/check-email?challenge_id=...`
2. The check-email page polls `/api/auth/challenge-status` waiting for status `approved`.
3. Operator clicks email link → `/auth/approve?token=...` consumes the challenge (sets status `approved`).
4. Polling tab sees approved → POSTs `/api/auth/complete-login` → that route reads back the pending cookies, optionally writes a `trusted_devices` row, sets the long-lived `opollo_device_id` cookie, redirects to `/admin/sites`.

Cookie codecs are in `lib/2fa/cookies.ts` (HMAC-signed via `COOKIE_SIGNING_SECRET`). `loadSigningSecret()` throws when the env var is unset — the entire 2FA flow fails closed in that case. Don't loosen it.

### 3.5 Trusted devices

A future sign-in from the same `opollo_device_id` cookie skips the email gate. `lib/2fa/devices.ts` owns the upsert. The complete-login route surfaces the upsert outcome in the response body via `trust_device_outcome` (added 2026-05-03 during UAT to debug an empty-list failure mode). Don't drop that field — it's the operator-visible diagnostic.

---

## 4. The page-generation pipeline (the hottest path)

**End-to-end:** brief upload → parse → commit → run → review → approve → publish.

### 4.1 Upload + parse

`POST /api/briefs/upload` — accepts a `.txt` / `.md` document or pasted text up to 10 MB. Insert a `briefs` row with `status='parsing'`, run `lib/brief-parser.ts` synchronously, then `status='parsed'` (or `failed_parse`). The parser tries three tiers in order:
1. **Structural** (markdown headings, `---` separators) — `parseByH2` / `parseByH1` / `parseByHrule`.
2. **Claude inference** — Sonnet pass that returns JSON page entries with source quotes.
3. **Single-page fallback** (added 2026-05-03 during UAT) — when the prior two return zero pages, treat the entire brief as one page. Title from leading heading or first line; mode from word count.

Tier 3 means a free-form brief never crashes the upload. The structural-failure log line `brief-parser.single_page_fallback` makes it visible.

### 4.2 Commit

`POST /api/briefs/[brief_id]/commit` — operator-edited page list + brand voice + design direction + `text_model` + `visual_model` selections, all sealed via `version_lock` CAS. After commit, briefs become read-only. The review surface auto-redirects to `/run` server-side; the commit handler also pushes there client-side.

There's a known **commit→/run race** that the run page mitigates by retrying the brief read up to 3× × 500ms when status is still `parsed`. PostgREST connection pools occasionally hand a stale read just after COMMIT.

### 4.3 Run (the cron-driven worker)

A `brief_runs` row gets inserted as `queued`. The cron `/api/cron/process-brief-runner` ticks every minute:
1. Reap expired leases (`reapExpiredBriefRuns`) — recover from worker crashes.
2. Lease the oldest queued run (`SELECT … FOR UPDATE SKIP LOCKED` + `version_lock` CAS).
3. Tick once — process exactly one page's worth of work (anchor cycle on page 1; later pages run normal text + visual passes).
4. Return — the next page processes on the next tick.

**Anchor cycle** — page 1 of every `page`-mode brief runs `MODE_CONFIGS.page.anchorExtraCycles` extra revise passes to lock site conventions (palette / spacing / structure) into `briefs.site_conventions` JSONB. Pages 2..N inherit. `post`-mode briefs skip this entirely.

**Visual-review cap** — every page runs at most 2 visual-critique iterations (`VISUAL_MAX_ITERATIONS`). When the cap fires with severity-high issues remaining, the page lands at `awaiting_review` with `quality_flag='capped_with_issues'`. Operators see this in the run UI.

**Cost ceiling** — `tenant_cost_budgets` enforces a per-page ceiling (`per_page_ceiling_cents_override`) AND a tenant-wide reserve (`reserveBudget`). Either trips the page to `awaiting_review` with `quality_flag='cost_ceiling'`. Don't skip this — it's the only thing standing between a stuck pass loop and an operator-bankrupting run.

### 4.4 Review

Run page is `app/admin/sites/[id]/briefs/[brief_id]/run/page.tsx`. Polls `/api/briefs/[brief_id]/run/snapshot` every 4s via `lib/use-poll.ts`. When a page lands at `awaiting_review`:
- The page card auto-expands.
- The rendered preview iframe auto-opens.
- The viewport scrolls to the awaiting card.

Operators get **Approve** / **Revise with note** / **Cancel run**. Approve writes `site_conventions` after page 1 and unblocks page 2. Revise re-fires the runner with the operator note appended; visual-cap resets.

### 4.5 Publish

`POST /api/sites/[id]/posts/[post_id]/publish` (or the page equivalent) — runs preflight against the WP REST API (capability probe, SEO plugin fingerprint), then publishes. Success populates `wp_page_id` / `wp_post_id`. Unpublish is the same row staying around with the WP id cleared — the `posts.id` is reused on re-publish.

---

## 5. Site modes (DESIGN-SYSTEM-OVERHAUL — load-bearing as of 2026-05-02)

`sites.site_mode` is `'copy_existing' | 'new_design' | NULL`. Set during onboarding at `/admin/sites/[id]/onboarding`. Drives:
- Which setup wizard runs (`/setup` for new_design, `/setup/extract` for copy_existing).
- What the appearance panel shows (`AppearancePanelClient` for new_design with Kadence preflight; `ExtractedProfilePanel` for copy_existing).
- Which design context gets injected into the brief-runner prompt:
  - **`new_design`** — `design_tokens` + `homepage_concept_html` + `tone_of_voice` (gated on `DESIGN_CONTEXT_ENABLED`).
  - **`copy_existing`** — `extracted_design` + `extracted_css_classes` (always on; mode is the gate).
  - **NULL** — pre-PR-10 fallback, no design context unless `DESIGN_CONTEXT_ENABLED` is on.

`lib/design-discovery/build-injection.ts` orchestrates the dispatch. Don't centralise design-context construction back into a single path — the mode-aware split is intentional.

`PageContext.siteMode` is also passed to the brief-runner system prompt so post-mode generation can issue `<blog_post_guidance>` (cleaner markup, less inline CSS) per `app/admin/sites/[id]/briefs/[brief_id]/review/page.tsx`.

---

## 6. Data layer

### 6.1 Supabase + Postgres + RLS

Two access paths:
- **PostgREST via `getServiceRoleClient()`** (`lib/supabase.ts`) — service role JWT bypasses RLS. Used by routes/jobs that need to operate across tenants or write audit rows. Most reads + writes from API routes.
- **Direct Postgres via `pg.Client`** (`lib/db-direct.ts`) — used by workers that need `SELECT FOR UPDATE SKIP LOCKED`, transaction-scoped advisory locks, and multi-statement transactions. PostgREST can't do those.

`lib/db-direct.ts` (introduced 2026-05-02) is the one place that parses `SUPABASE_DB_URL`. **Do not** revert to passing `connectionString` to `pg.Client` — `pg-connection-string@2.12.0`'s `new URL(str, 'postgres://base')` fallback bites on Vercel runtime versions where the WHATWG URL parser drops the host for non-special schemes. The helper parses the URL ourselves with Node's URL constructor and passes explicit `{host, port, user, password, database, ssl}` fields. Localhost is detected for SSL-disable; everything else gets `{rejectUnauthorized: false}`.

### 6.2 Optimistic concurrency

Every long-lived row carries `version_lock int default 1`. Mutating writes use `WHERE id = $1 AND version_lock = $2 RETURNING ...`. Zero rows returned = conflict — the route returns `VERSION_CONFLICT` (409). Clients refresh and retry. Don't replace this with last-writer-wins.

### 6.3 Soft delete

Per `docs/DATA_CONVENTIONS.md`: most tables get `deleted_at timestamptz, deleted_by uuid` plus an `_active` view that filters them out. New tables follow this convention. Do not introduce hard deletes for operator-visible entities; deletion is a workflow, not an event.

### 6.4 Audit columns

`created_at, updated_at, created_by, updated_by` everywhere. `created_by` / `updated_by` are nullable but populated by trigger when a session user is set. Server-side mutations using service role often pass these explicitly.

### 6.5 Migrations

`supabase/migrations/` — sequentially numbered (`0001_…` through `0070+`). Append-only. Never edit a landed migration. Never reuse a number. **Watch out:** there's a known collision between `0031_email_log.sql` and `0031_optimiser_clients.sql` (the latter renumbered to 0066 in a hotfix branch but not yet on main as of 2026-05-02). E2E + vitest CI jobs both fail at "Start Supabase local stack" because of this — the failure pattern is environmental, not your code. Same goes for the m12-1-rls / m4-schema / m2b-rls test suite reds.

`supabase/data-migrations/` is for non-schema data backfills (e.g. `OPOLLO_FIRST_ADMIN_EMAIL` seeding). Same rules.

---

## 7. The cron + queue model

There are 5 worker crons + 15 optimiser crons (see `vercel.json`). Each minute-cadence cron:
1. Reads from one queue table.
2. Leases the oldest claimable row.
3. Does one unit of work.
4. Returns.

**Worker queues:**
| Queue table | Cron | Owner module |
|---|---|---|
| `brief_runs` | `/api/cron/process-brief-runner` | `lib/brief-runner.ts` |
| `generation_jobs` (slots) | `/api/cron/process-batch` | `lib/batch-worker.ts` + `lib/batch-publisher.ts` |
| `regeneration_jobs` | `/api/cron/process-regenerations` | `lib/regeneration-worker.ts` |
| `transfer_jobs` | `/api/cron/process-transfer` | `lib/transfer-worker.ts` |
| (no queue) | `/api/cron/budget-reset` | `lib/tenant-budgets.ts` |

`/admin/system/jobs` (super_admin only, added 2026-05-03) shows queue depth + cron schedule. Use that as the operator surface; don't paste raw SQL queries into operator instructions.

### Cron auth

Every cron requires `Authorization: Bearer $CRON_SECRET`. Vercel injects the header automatically when the cron fires. Manual triggers (curl) need the same header. Don't add a no-auth fallback.

### Idempotency

Slot work is keyed on `anthropic_idempotency_key` and `wp_idempotency_key`. Don't change those keys without understanding the 24h Anthropic dedup window — replays must produce the same key or you'll double-bill. Same goes for transfer-job items (`cloudflare_idempotency_key`).

---

## 8. External integrations

| Integration | Purpose | Env vars | Failure mode |
|---|---|---|---|
| **Anthropic SDK** | All LLM calls | `ANTHROPIC_API_KEY` | Hard required |
| **Supabase REST + Auth** | Primary DB + session auth | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` | Hard required |
| **Supabase direct Postgres** | SKIP LOCKED + advisory locks | `SUPABASE_DB_URL` | Hard required for workers |
| **WordPress REST API** | Publish pages/posts, sync palette | Per-site app passwords stored in `site_credentials` (AES-256-GCM, master key `OPOLLO_MASTER_KEY`) | Per-site optional |
| **Cloudflare Images** | Image hosting | `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_IMAGES_API_TOKEN` / `CLOUDFLARE_IMAGES_HASH` | Optional — image library is opt-in |
| **SendGrid** | Transactional email (invites, 2FA, approval) | `SENDGRID_API_KEY` / `SENDGRID_FROM_EMAIL` / `SENDGRID_FROM_NAME` | Hard required for invites + 2FA |
| **Microlink** | Screenshot capture for design discovery | `MICROLINK_API_KEY` (optional) | Soft-fail — extraction proceeds without screenshot |
| **Sentry** | Error reporting | `SENTRY_DSN` (optional) | No-op when unset |
| **Axiom** | Structured log shipping | `AXIOM_TOKEN` / `AXIOM_DATASET` (optional) | In-memory logger fallback |
| **Langfuse** | LLM observability | `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_HOST` (optional) | Wrapped Anthropic call no-ops the trace |
| **QStash (Upstash)** | Future scheduled callbacks | `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Soft-fail today; growing path |
| **Cron secret** | Inbound cron auth | `CRON_SECRET` | Hard required |

**Encryption contract:** every credential we store is AES-256-GCM with a single project-level master key (`OPOLLO_MASTER_KEY`). `lib/encryption.ts` is the only encrypt/decrypt path. Don't introduce a second master key or a different cipher. Rotation is documented in `docs/RUNBOOK.md`.

**Email contract:** `lib/email/sendgrid.ts` + `lib/email/templates/base.ts` are the only places that import `@sendgrid/mail`. Direct imports outside those two files are a code-review block. Every send writes to `email_log`.

---

## 9. The observability + security contract

These invariants land in every PR. Don't break them:

- **Request IDs** — every HTTP response carries `x-request-id`. `middleware.ts` propagates incoming UUID or mints UUIDv4. `lib/logger.ts` reads it from AsyncLocalStorage automatically. Never log "unknown" — fix the propagation.
- **Structured logging** — only `import { logger } from "@/lib/logger"`. No `console.log` in prod paths. JSON-per-line, pulls context fields from AsyncLocalStorage, sanitises Error/bigint/deep objects.
- **Health endpoint** — `/api/health` is the liveness/readiness contract. Add a check for any new hard dependency.
- **Security headers** — `lib/security-headers.ts` is the single source of truth. Don't relax a header per-route without a comment explaining why.
- **CSP** — `connect-src` is allowlist-based. New external domains need explicit additions in `lib/security-headers.ts`.
- **Supply-chain** — CodeQL + Dependabot + gitleaks run on every PR. New dependencies must clear CodeQL.
- **No secrets in HTML** — anything reaching client-side bundles via `NEXT_PUBLIC_*` is public. Never put a secret in a NEXT_PUBLIC variable.

---

## 10. Brand voice + design direction inheritance

Per-site defaults: `sites.brand_voice` + `sites.design_direction` (text columns, set at `/admin/sites/[id]/settings` via `SiteVoiceSettingsForm`).

Per-brief overrides: `briefs.brand_voice` + `briefs.design_direction` (set at commit time on the review surface).

Inheritance: the review surface reads site defaults via `siteBrandVoiceDefault` / `siteDesignDirectionDefault` props. When site defaults exist AND the brief has no override, the editor renders collapsed ("inheriting"). Operators can "Customize for this brief" to override. The override is brief-scoped and never touches the site row.

When proposing changes to the prompt-context build pipeline: the inheritance happens at COMMIT time (server reads brief.brand_voice → site.brand_voice → empty). The runner receives the resolved value, not the source. Don't move the resolution into the runner — that'd defeat per-brief overrides.

---

## 11. Image library (opt-in)

`sites.use_image_library` (boolean, default false). Toggleable on `/admin/sites/[id]/settings`. When on, the brief runner calls `buildImageLibraryContextPrefix({siteId, topic})` which queries `image_library` for active rows whose caption + alt_text match the topic via `websearch_to_tsquery`. Up to 5 results inline as `<image_library_context>` so the model can reference URLs.

Off by default until operators verify metadata quality. Don't flip the global default to `true` — it broadens the attack surface for hallucinated URLs (see `lib/strip-hallucinated-images.ts` — mitigation added 2026-05-03).

`lib/strip-hallucinated-images.ts` runs after every `extractHtmlFromAnthropicText` in the brief runner. Permits `imagedelivery.net` (Cloudflare Images) + `data:` URIs; everything else gets neutralised to a 1×1 placeholder + alt-text marker. Don't widen the allowlist without grounding (e.g. without piping the source-site origin in for `copy_existing` flows — currently a known limitation).

---

## 12. Direct-Postgres workers — the lib/db-direct.ts contract

All direct-Postgres workers go through `lib/db-direct.ts:requireDbConfig()`. Workers that already migrated:

- `lib/brief-runner.ts`
- `lib/batch-worker.ts`
- `lib/batch-jobs.ts`
- `lib/batch-publisher.ts`
- `lib/regeneration-worker.ts`
- `lib/regeneration-publisher.ts`
- `lib/transfer-worker.ts`
- `lib/tenant-budgets.ts`
- `lib/auth-revoke.ts`
- `app/api/cron/process-brief-runner/route.ts`

If you add a new direct-Postgres workflow: import `requireDbConfig` from `@/lib/db-direct`, never construct a `pg.Client` with `connectionString` directly.

---

## 13. Frontend conventions

### 13.1 Server Components by default

Pages under `app/admin/*` are server components by default. Promote to client only when you need state, polling, or interactivity. Mark client-side files with `"use client"` at top.

### 13.2 Polling for live state

`lib/use-poll.ts` is the canonical hook for surface-polling (run page, batch detail, etc.). 4s default interval, AbortController per-fetch, visibility-aware pause. Don't roll a new polling hook.

### 13.3 Tailwind + shadcn/ui

- Tailwind utility-first. No CSS modules.
- shadcn/ui primitives in `components/ui/*`. Don't create a custom Button when `Button` exists.
- Status pills go through `components/ui/status-pill.tsx` — adding a new status means adding to the kind union + STATUS_MAP.
- Typography minimum: `text-base` (16px) for body, `text-sm` (15px after the 2026-05-03 floor bump) for helper. `text-xs` is forbidden and overridden to 15px sitewide via `app/globals.css`. Lucide icons floor at 20px (`svg.lucide`) — same source.

### 13.4 Toast pattern

Use `components/ui/toast.tsx` + `Toaster`. `useToast()` for triggering. Don't introduce a second notification system.

### 13.5 Debug footer

`components/DebugFooter.tsx` (super_admin only, mounted in `app/admin/layout.tsx` and `app/account/layout.tsx`). Captures last 20 `/api/*` requests with x-request-id. Click → Copy bundles route + build SHA + viewport + UA + recent events. Designed for operator → engineering chat hand-off. Don't break the fetch interceptor — a refactor that breaks it silently degrades the diagnostic.

---

## 14. Testing layout

### 14.1 Unit tests (vitest)

`lib/__tests__/*.test.ts`. Globally configured to spin up local Supabase (`supabase start`) before any test runs (`lib/__tests__/_globalSetup.ts`). **Requires Docker.** If you don't have Docker, vitest fails before any test runs. CI has Docker; local without Docker doesn't.

There's a known set of pre-existing red tests that fire on every PR through this UAT period:
- `m12-1-rls.test.ts`
- `m4-schema.test.ts` (RLS suite)
- `m2b-rls.test.ts`
- `m3-schema.test.ts` (RLS suite)
- `admin-users-role.test.ts` / `admin-users-revoke.test.ts` / `admin-users-invite.test.ts`
- `admin-api-gate.test.ts`
- `admin-gate.test.ts`
- `reset-admin-password-route.test.ts`
- `batch-cancel.test.ts`

These are environmental, not caused by code changes. They've been red since the migration 0031 collision landed. If your PR introduces a NEW red, that's a real regression.

### 14.2 E2E tests (Playwright)

`e2e/*.spec.ts`. Same Supabase requirement. Drives the actual UI through a browser. Every PR that adds or substantially changes an admin route MUST add or update a Playwright spec for the happy path. See `CLAUDE.md` § "E2E coverage is a hard requirement".

### 14.3 Integration tests

Don't mock the database. Per memory note: "we got burned last quarter when mocked tests passed but the prod migration failed." Hit a real local Supabase via the globalSetup.

### 14.4 Don't add an alternate test runner

vitest is the only runner. No jest, no mocha, no node:test. Don't propose switching.

---

## 15. The retention contracts

- **Screenshots** — visual review captures screenshots to a tmpdir, sends to Anthropic, deletes. **Never** persist screenshot bytes to Supabase Storage or DB. The runner's parent plan calls this out as Risk #8.
- **Anthropic responses** — full response payloads are NOT logged or persisted. Token counts + cost cents are. Critique text is OK.
- **Auth cookies** — see § 3.4. HMAC-signed, short-lived for pending; long-lived for trusted device.
- **Email log** — `email_log` rows persist forever (audit), but never carry message bodies. Subject + recipient + send result only.

---

## 16. Things that look unused but are load-bearing

These traps will catch a "dead code" sweep. Don't delete:

- **`design_system_versions` table** — UI-only edit surface for raw CSS strings. NOT consumed by the brief runner today (per CLAUDE.md §Q1 audit). Hidden behind an Advanced disclosure on `/admin/sites/[id]/design-system`. Looks abandoned, isn't — operators occasionally reach for raw-CSS overrides.
- **`design_systems` table (singular)** — separate from `design_system_versions`. Gated by `FEATURE_DESIGN_SYSTEM_V2`. When the flag is on AND a row is active, `lib/system-prompt.ts:resolveDesignSystemSlot` injects `tokens_css` + component/template registry into the prompt. Different code path from the four-tab UI. Doesn't currently feed copy_existing or new_design — it's a third lane.
- **`brief-runner-dummy.ts`** — substitutes for Anthropic + Playwright when their env vars aren't set. Used by E2E tests AND when `ANTHROPIC_API_KEY` is unset (early dev). Don't delete.
- **`requireDbConfig` localhost SSL detection** — looks like a CI-only branch. It's not — local dev (`supabase start` Docker image) hits the same path.
- **`opollo_pending_device_id` cookie** — separate from `opollo_pending_2fa_token`. Both are needed for the trust-device upsert at complete-login time. Don't merge them — they have different lifecycles.
- **The `Path-A` document branch in `lib/preview-iframe-wrapper.ts`** — for legacy generations + the dcbdf7d5 evidence page. Not exercised in the modern flow but kept for back-compat.
- **`brief-runner.ts` `processSlotAnthropic` second response variant for stub mode** — mirrors the production path; tests rely on it.

---

## 17. In-flight workstreams (don't undo these)

- **Path B** (PB-1+) — fragments-only generation, inline CSS budget capped at 200 chars, mandatory `data-opollo` wrapper, site-prefixed classes. See `docs/plans/path-b-migration-parent.md`. The model's system prompt enforces this in `lib/brief-runner.ts:574-609`. Don't reintroduce full-document generation paths.
- **DESIGN-SYSTEM-OVERHAUL** — see § 5. Site mode dispatch is the load-bearing piece.
- **AUTH-FOUNDATION (P1–P4)** — the role rename, invites table, login_challenges + trusted_devices, audit log, are all current state. The full picture is in `CLAUDE.md` AUTH-FOUNDATION section + UAT-CHECKLIST § 1.
- **PLATFORM-AUDIT** — `npm run audit:static` runs `scripts/audit.ts` which ships a static-analysis suite (middleware coverage, auth gates, db references, migration sanity, typography, env vars, error handling, dead routes). HIGH severity gates CI. Adding a new check is a small PR; loosening an existing one needs `docs/RULES.md` justification.
- **Optimiser** — see § 2. Currently on `feat/optimiser` branch, not main.

---

## 18. Things that DO need rearchitecting (Steven's note 2026-05-03)

This is the section you (the AI rearchitecting) should read most carefully. These are areas Steven knows are not great today; redesign here is welcome but the constraints below are not negotiable.

### Multi-tenancy / "client" isolation

Today this is a single-tenant tool — operators are Opollo's team, sites are clients-of-Opollo, but everything runs in one Supabase project with no per-client isolation. RLS policies are role-based, not tenant-scoped. The expected next step is layering customer/tenant boundaries:
- A `customers` (or `companies`) table that owns sites.
- RLS policies scoped to customer membership.
- Per-customer dashboards, billing, quotas.

**Constraints when proposing this:**
- Can't break the existing role tiers (`super_admin` / `admin` / `user`) — those are operator tiers, not customer tiers. The new layer is **customer membership**, orthogonal to operator role.
- All workers run with service-role access today (bypass RLS). Adding tenant scoping must respect the worker → service-role split: workers see all rows; user-facing routes scope by membership.
- Migration `0001` already shipped before tenancy was a concept. Most existing rows have no `customer_id`. The migration to add tenant scoping MUST handle the "attribute existing rows to customer X" decision explicitly — don't propose `ALTER TABLE … ADD COLUMN customer_id NOT NULL` as a single migration; it'll fail.
- The optimiser module already has a `opt_clients` model. **Do not** unify the optimiser's client model with the page-builder's customer model in a single PR — they're separate domains and a unification PR would touch every file in both halves. Build the page-builder side first; do the unification later if it makes sense.

### Operator / customer segregation

Today operators see everything. The "viewer" role is a legacy tier with no operator-visible surfaces. Real customer-facing dashboards (where a paying customer logs in to see their own sites) don't exist yet.

**Constraints:**
- Customer-facing UI lives under a different route prefix (`/customer/*` or similar) so middleware can apply different policy.
- Customer auth uses a different layout shell — admin chrome (sidebar with Sites, Batches, Images) is operator-only. Customers see their site list + briefs + nothing else.
- Don't bolt customer auth onto the existing `/admin/*` routes. Different gate, different layout, different role-gate code.

### Per-customer billing / quotas

`tenant_cost_budgets` exists today but is keyed on `site_id`, not customer. If you redesign to customer-level budgets:
- Don't drop the per-site ceiling — it's a runaway-cost circuit-breaker that fires before the customer-level check could kick in.
- Reserve + release semantics (`reserveBudget` / `releaseBudget`) are correct today; preserve those primitives even if you change what they wrap.

### What you can refactor freely

- The brief upload modal (`UploadBriefModal.tsx`) — UX shell only.
- The setup wizards (`/setup` and `/setup/extract`) — flow logic, not data contracts.
- The admin sidebar (`AdminSidebar.tsx`) — navigation only.
- Helper / utility modules that don't carry data contracts.
- Anything under `components/ui/` — design system primitives, refactor at will.

### What you cannot refactor without explicit Steven approval

- Anything in `lib/brief-runner.ts` or `lib/batch-worker.ts` (the runners that run real money)
- `lib/db-direct.ts` (recently fixed for the `ENOTFOUND base` bug)
- `lib/encryption.ts` (master-key contract)
- `lib/2fa/*` (auth flow)
- `lib/security-headers.ts` (CSP + headers)
- Any migration that's already landed on main
- The `Path B` envelope contract in the runner system prompt

---

## 19. Standard glossary

- **Brief** — operator-uploaded document describing pages or posts to generate.
- **Page** — a brief_pages row; the unit of generation. Has a status, draft_html, critique_log.
- **Pass** — one Anthropic call against a page (kinds: anchor, revise, self_critique, visual_critique, visual_revise).
- **Anchor cycle** — the page-1-only extra revise loop that locks site_conventions. Skipped on post-mode briefs.
- **Site conventions** — palette / spacing / structure decisions frozen after page 1's anchor cycle. JSONB on the brief row. Pages 2..N inherit.
- **Slot** — a unit in a `generation_jobs` batch (M3 path, distinct from the brief runner). Each slot generates one WP page.
- **DS / design system** — the catalog of components + templates + tokens that pages may reference. Two registries (legacy `design_system_versions` vs flag-gated `design_systems` singular). See § 16.
- **Site mode** — `copy_existing` vs `new_design` vs NULL. § 5.
- **Tenant cost budget** — daily + monthly caps on per-site Anthropic spend. Reserve/release pattern.
- **Path B** — the fragments-only HTML envelope contract. § 17.

---

## 20. Quick-reference table — file paths for common concerns

| If you're touching… | Read this first |
|---|---|
| Auth gates | `lib/admin-gate.ts`, `lib/admin-api-gate.ts`, `lib/auth.ts`, `middleware.ts` |
| 2FA flow | `lib/2fa/{cookies,challenges,devices}.ts`, `app/api/auth/{complete-login,approve,challenge-status,resend-challenge}/route.ts`, `app/login/check-email/page.tsx`, `components/CheckEmailPolling.tsx` |
| Brief upload + parse | `app/api/briefs/upload/route.ts`, `lib/briefs.ts`, `lib/brief-parser.ts`, `components/UploadBriefModal.tsx`, `components/BriefReviewClient.tsx` |
| Brief run loop | `lib/brief-runner.ts`, `app/api/cron/process-brief-runner/route.ts`, `components/BriefRunClient.tsx`, `lib/visual-review.ts` |
| Direct Postgres connections | `lib/db-direct.ts` (the only place that reads `SUPABASE_DB_URL`) |
| Encryption / credentials | `lib/encryption.ts`, `site_credentials` table, `OPOLLO_MASTER_KEY` env |
| Email | `lib/email/sendgrid.ts`, `lib/email/templates/base.ts` |
| WP REST | `lib/wordpress.ts`, `lib/wordpress-posts.ts`, `lib/site-test-connection.ts` |
| Cloudflare Images | `lib/cloudflare-images.ts`, `lib/transfer-worker.ts` |
| Static audit / lint | `scripts/audit.ts`, `npm run audit:static`, `docs/RULES.md` |
| Operator runbook | `docs/RUNBOOK.md` |
| Data conventions | `docs/DATA_CONVENTIONS.md` |
| Prompt versioning | `docs/PROMPT_VERSIONING.md`, `lib/prompts/v*` |
| UAT checklist | `docs/UAT-CHECKLIST.md` (round-by-round procedure) |

---

## 21. Final word

This codebase is operationally hot — it spends real Anthropic money, mutates real client WordPress sites, and is where Steven runs UAT. **The cost of a regression is high.** Refactor proposals get a sceptical first read. If you're moving load-bearing things, write the "Risks identified and mitigated" section per `CLAUDE.md` BEFORE you write code. Reviewers (Steven and any AI doing /ultrareview) read that section first.

Don't propose a refactor without:
1. Listing the files / contracts you're touching.
2. Listing what would break if your proposal is wrong.
3. Writing the migration plan — for code AND for data — as a numbered list.
4. Identifying which sections of this doc would need updates after your change lands.

That last item is the tell that you've actually internalised this doc rather than skimmed it.
