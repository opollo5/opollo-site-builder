# Backlog

Explicitly deferred work. Each entry has: **what**, **why deferred**, **trigger to pick it up**, **rough scope**. If something blocks a live incident, it jumps out of here the same day.

Sort order: strongest "pick up when" signal at the top. Rows with no signal move to the bottom.

---

## PDF / .docx brief parser (deferred from M12-6, 2026-04-24)

**What:** Extend `lib/brief-parser.ts` to accept `application/pdf` and `application/vnd.openxmlformats-officedocument.wordprocessingml.document` in addition to `text/plain` + `text/markdown`. The existing structural-first + Claude-inference-fallback parser runs against the extracted text; the only new work is the MIME-specific binary → UTF-8 decoder.

**Why deferred:** Parent plan M12-6 called this a stretch ("skip if non-trivial, add to BACKLOG"). The integration is non-trivial: each parser is a separate npm dep (`pdf-parse`, `mammoth`) with its own footgun (pdf-parse silently loses formatting on scanned PDFs; mammoth's output includes odd Word artifacts that need post-processing). Both deps also bloat the Next.js serverless bundle — would need `serverComponentsExternalPackages` entries in `next.config.mjs` similar to the M12-4 playwright-core fix. Scope is >1 day of careful work; the markdown happy-path covers the 90% operator workflow today.

**Trigger:** First operator request to upload a brief they already have as a PDF (investor deck, client proposal) and doesn't want to retype. Probably lands within the first 10 real sites.

**Scope:**
- Add `pdf-parse` + `mammoth` deps (note: both are CJS-only; next.config needs `serverComponentsExternalPackages: ["pdf-parse", "mammoth"]` — exact same treatment as `playwright-core` from M12-4)
- Extend `BRIEF_ALLOWED_MIME_TYPES` in `lib/briefs.ts`
- In `uploadBrief`, branch on MIME type: call `pdf-parse` or `mammoth` before the existing `new TextDecoder("utf-8")` path
- Feature-flag behind `OPOLLO_BRIEF_BINARY_PARSERS=1` for the first rollout so a regression in the binary path doesn't regress the text/markdown happy path
- Parser unit tests with one real PDF fixture + one real .docx fixture (redacted)
- Update the upload-form accept attribute + the operator help copy in `AddBriefModal.tsx`

**Non-goals:** OCR for scanned PDFs (`pdf-parse` returns blank text; out of scope, fail cleanly with `BRIEF_PARSE_FAILED`). Rich-text preservation (tables, images) — extract text only. The visual review pass regenerates design from scratch anyway.

**Size:** Medium — ~3-4 hours PR with the two parser libs, feature flag, fixtures, and test coverage.

---

## Auth polish deferred from M14 (2026-04-24)

Surfaced by the M14 auth-gap audit. Deferred with Steven's explicit call: M14 stays focused on password reset; these get picked up when they actually cost someone time.

- **Invite TTL + revocation.** `app/api/admin/users/invite` generates a Supabase invite link but has no expiry beyond Supabase's built-in, and no "cancel pending invite" admin action. Pick up trigger: an admin mistakenly invites the wrong email and can't revoke. Scope: new `invites` table with `expires_at` + `revoked_at`, a DELETE route, and an admin-UI "pending invites" row list.
- **Session expiry pre-warning.** Middleware redirects to `/login` when the JWT expires; no "session about to expire" UI, no session-extend prompt. Pick up trigger: an operator loses mid-workflow state because of an expiry they didn't see coming. Scope: client-side expiry timer + pre-expiry toast + "extend session" action that refreshes the token.

## UX polish deferred from M15 (2026-04-24)

Captured during UAT prep in parallel with M15-7. Deferred to avoid collision in concurrent development; highest-priority UX fixes picked up once M15-7 ships.

### Admin top navigation redesign

**What:** Current top nav at `/admin` is functional but unpolished: links stretch wide across the full screen width, spacing between items is inconsistent, user email + Security + "Back to builder" + Sign out are all crammed into the right edge with no visual hierarchy. Feels like a prototype, not a product.

**Why deferred:** Captured during UAT prep after being observed live. M15-7 is mid-flight.

**Trigger:** After M15-7 Phase 4 completes, paired with the site actions menu fix (similar file surface, same review).

**Desired end state (professional SaaS admin pattern):**
- Left side: logo + primary nav (Sites, Batches, Images, Users) — compact, grouped, clear visual separation from right side
- Right side: user menu as a single button (avatar or email with chevron) that opens a dropdown containing: Security, Back to builder, Sign out, any future account actions
- Collapse the cluttered right-edge links into that dropdown
- Add subtle visual treatment: border-bottom, slight background contrast, or shadow to separate nav from page content
- Responsive: collapse nav items to hamburger on mobile widths
- Active route indicator on the current page link (underline, bold, or background accent)
- Consistent horizontal padding, max-width container so nav doesn't stretch edge-to-edge on wide screens

**Inspiration patterns:** Vercel dashboard, Linear, Stripe Dashboard, Supabase dashboard top nav

**Files likely involved:** Top-level admin layout component (probably `app/admin/layout.tsx` and a Nav or Header component), plus any user menu dropdown component

**Size:** Medium — ~60-90 min focused PR. Needs care because it touches every admin page.

**Non-goals for this slice:** Don't redesign page content, sidebars, or individual table layouts. Scope is strictly the top nav bar.

### Brief commit confirmation — dead-end screen with no next action

**What:** After uploading a brief and confirming it, the user sees a green box saying "This page list is committed. Starting generation runs becomes available in M12-5." — but no button to take them anywhere. User is stranded on the current page with no clear next action.

**Why deferred:** Captured during UAT prep. M15-7 just finished; UX polish slice will batch this with other items.

**Trigger:** Paired with the site actions menu fix and admin top nav redesign in the UX polish slice.

**Fix scope:**
- Replace the dead-end green message with a proper confirmation state that includes a primary CTA button: "Back to briefs" (returns to `/admin/sites/[id]/briefs` or wherever the briefs list lives)
- Remove jargon — "M12-5" is internal milestone language, not user-facing. Replace with user-friendly copy like: "This brief is locked in. Page generation will be available soon — we'll email you when it's ready" OR, if M12-5 has already shipped by the time this is fixed, remove the disabled messaging entirely
- Consider an auto-redirect after a few seconds if no button is clicked, so refresh-happy users aren't stuck
- Audit the rest of the app for similar dead-end confirmation states — any "feature X is complete" screen without a CTA pointing to the logical next step

**Files likely involved:** `app/admin/sites/[id]/briefs/[briefId]/page.tsx` or component rendering the commit confirmation

**Size:** Small — ~20-30 min if isolated, bundle with UX polish slice for efficiency

## M12-6 — Save-Draft persistence for briefs review

Surfaced by the `fix(e2e)` slice (2026-04-24). The M12-1 slice plan §6.2 called for a "Save draft" button that persists `brief_pages` edits under `version_lock` before commit. That button was never implemented — the commit endpoint therefore 409s on any edit-then-commit flow because the client's hash is computed from in-memory edits while the server recomputes from unedited DB rows. The happy-path E2E in `e2e/briefs-review.spec.ts` is `test.fixme`'d until this lands. Pick up trigger: M12-6 starts. Scope: new `PATCH /api/briefs/[brief_id]/pages` endpoint + "Save draft" button wired into `BriefReviewClient.tsx` + re-enable the fixme'd test.

---

## M15 audit residue (2026-04-24)

The M15 audit series surfaced **~100 findings** across five audits — M15-2 schema (14), M15-3 env (14), M15-4 endpoints (19), M15-5 cross-cutting risk (27), M15-6 test coverage (~30). Roughly half shipped during the series; the rest are catalogued below.

Reports live at:
- `docs/SCHEMA_AUDIT_2026-04-24.md` (M15-2)
- `docs/ENV_AUDIT_2026-04-24.md` (M15-3)
- `docs/ENDPOINT_AUDIT_2026-04-24.md` (M15-4)
- `docs/PRODUCTION_RISK_AUDIT_2026-04-24.md` (M15-5)
- `docs/TEST_COVERAGE_AUDIT_2026-04-24.md` (M15-6)

### Shipped during the M15 series (reference index)

| PR | Scope |
|---|---|
| #127 | M15-3 fix: env-coupling validation at boot (`lib/env-validation.ts`), dead env vars removed from `.env.local.example` (`DEFAULT_TENANT_*`), `LANGFUSE_BASEURL`→`LANGFUSE_HOST` typo, `REGEN_RETRY_BACKOFF_MS` reclassified as code constant, `OPOLLO_PROMPT_VERSION` "not yet shipped" banner, `OPOLLO_MASTER_KEY_NEXT` runbook section rewritten to match single-key reality |
| #128 | Parallel session: dead M1 schema tables dropped (`page_history`, `site_context`, `pairing_codes`, `health_checks`, `chat_sessions`, `chat_sessions_archive`) |
| #129 | Parallel session: `version_lock >= 1` CHECK constraints on 5 tables, `updated_at` set on batch-cancel UPDATE, Zod↔DB column sync test |
| #130 | M15-4 fix: chat SSE error sanitization (`lib/chat-errors.ts`), `countActiveAdmins()` helper shared by `role` + `revoke` (LAST_ADMIN filter on `revoked_at IS NULL`) |
| #131 | M15-7 Phase 1: `lib/encryption.ts` unit tests (24 tests — round-trip, tamper, wrong-key, invalid env, key version, malformed input), `RUNBOOK.md` summary reconciliation |
| #132 | M15-7 Phase 2: 6 `console.error` sites → `logger.error`, 17 `err.message` leak sites sanitized across 9 routes, `lib/briefs.ts` parse-finalize UPDATE now has `version_lock` CAS |
| #133 | M15-7 Phase 3a: `app/api/chat/route.ts` integration tests (12 tests) |
| #134 | M15-7 Phase 3b: `app/api/tools/*` route tests (28 tests across 7 files) |
| #135 | M15-7 Phase 3c: `lib/wordpress.ts` unit tests (58 tests) |

### Open — operational decisions needed

- **[M15-5 #1] `/api/cron/process-transfer` not in `vercel.json`.** Route exists, worker is correct, nothing fires it. Trace in `docs/PRODUCTION_RISK_AUDIT_2026-04-24.md` showed publish-flow image transfer is inline-synchronous; only the iStock seed CLI creates `transfer_jobs` rows that need the cron to drain. **Decision needed:** run `SELECT count(*) FROM transfer_job_items WHERE state = 'pending';` — if `0`, delete route + `lib/transfer-worker.ts` (dead code); if `>0`, wire cron. Pick up trigger: Steven's DB check. Scope: either 1 line added to `vercel.json` + cron monitoring, or ~600 lines deleted (worker + route + tests).
- **[M15-5 #2] `bumpTenantUsage()` exported but never called.** Tenant budget counters track reservations only; actual-cost writeback helper is defined but unwired. Resolved during M15-7 as COSMETIC: `PROJECTED_COST_PER_BATCH_SLOT_CENTS = 30` and `PROJECTED_COST_PER_REGEN_CENTS = 30` are worst-case ceilings per the author's comment ("conservative — actual costs tend to be lower"). Tenants under-utilize caps but cannot overspend. Pick up trigger: tenant reports under-utilization complaint, OR we want actual-vs-projected reconciliation for billing accuracy. Scope: wire `bumpTenantUsage` into batch-worker slot-completion + regen finalization paths with the delta `actual - reserved`.

### Open — grouped by next-natural-slice trigger

#### Security / auth tightening (next security review pass)

- **[M15-4 #3] `tools/*` write routes have no session requirement.** `tools/publish_page`, `tools/update_page`, `tools/delete_page` are reachable with just a rate-limit token. M15-7 Phase 3b (#134) pinned current behaviour in tests; when auth gets tightened, tests will need to update. Scope: add `requireAdminForApi(['admin', 'operator'])` to the three write routes + refresh the tests.
- **[M15-4 #8] 6 public GET routes have no route-level auth gate.** `sites/list`, `sites/[id]`, `sites/[id]/design-systems`, `design-systems/[id]/components`, `design-systems/[id]/templates`, `design-systems/[id]/preview` rely entirely on middleware. Defense-in-depth gap. Scope: add `requireAdminForApi()` to each; cost is one import + one check per route.
- **[M15-4 #11] `tools/*` routes don't seed `runWithWpCredentials()` context.** Direct POST outside the chat flow → executor uses empty AsyncLocalStorage context. Needs verification that direct calls fail safely. Scope: either (a) remove the tools routes if only used internally by chat, or (b) seed context from the request body's `site_id`.
- **[M15-5 #12] `image_usage` RLS excludes `viewer` role.** Asymmetry vs `image_library` + `image_metadata`. Check if intentional; if so, comment the migration; if not, align the policy.

#### Observability + write-safety hygiene (next defense-in-depth slice)

- **[M15-4 #5] `retryable: true` on VALIDATION_FAILED in 5 routes.** Admin/images/[id], admin/sites/[id]/budget, admin/sites/[id]/pages/[pageId], admin/users/invite, admin/users/[id]/role. Clients with auto-retry loop forever on fixable input. Scope: force `retryable: false`; migrate the 5 holdouts to `lib/http.validationError()`.
- **[M15-4 #6] No timeouts on external-call fetches** anywhere in the codebase (only `Sentry.flush(5000)` exists). Hanging Anthropic/WP/Supabase/Upstash drains function pool. Scope: `withTimeout(promise, ms)` helper in `lib/http.ts`; wrap external calls. Suggested initial values: Anthropic 60s, WordPress 30s, Cloudflare 30s, Supabase 15s.
- **[M15-4 #7] ~15 routes still have no structured logging.** Partial coverage via #132 (9 routes + 2 libs). Remaining: admin/batch POST, admin/images/[id] restore, admin/sites/[id]/budget, admin/sites/[id]/pages/[pageId] and its regenerate, auth/callback, design-systems/*, sites/register, sites/[id], sites/[id]/design-systems, sites/list, tools/* (all 7). Scope: add `logger.error()` on every error-return path; incremental, one route at a time.
- **[M15-4 #12] Malformed JSON behavior inconsistent.** Old pattern (`try { body = req.json() } catch { body = {} }`) gives confusing "missing field" error; new pattern (`lib/http.readJsonBody`) gives clear "Request body must be valid JSON." Migration incomplete. Scope: migrate old-pattern routes to `readJsonBody` + `parseBodyWith`.

#### Rate-limiting coverage (next rate-limit slice)

- **[M15-4 #9] 9 sensitive routes without a rate limit.** User-mgmt (revoke, reinstate, role), budget PATCH, briefs upload (10MB), design-system writes, `sites/list`, `design-systems/[id]/preview`. Scope: add named buckets in `lib/rate-limit.ts` (`user_mgmt`, `admin_write`, `briefs`); wire each route.

#### Schema + constraint polish (next migration slice)

- **[M15-2 #4] Missing index on regen daily-budget query.** `lib/regeneration-worker.ts#checkDailyBudget` does `.select("cost_usd_cents").gte("created_at", startOfDay)` with no supporting index. Per-enqueue cost. Scope: either add `idx_regen_jobs_created_at` partial index or scope the query to `site_id` (existing composite index then covers it).
- **[M15-2 #5] No cancel endpoint for `transfer_jobs`.** Schema has `cancel_requested_at` column; no route uses it. Overlaps with [M15-5 #1] — if transfer cron is wired, add cancel; if cron is dead, drop the column.
- **[M15-2 #8] Event-table PK type inconsistency.** `generation_events` + `regeneration_events` are `bigserial`; `transfer_events` is `uuid`. Cosmetic unless we build a unified event stream.
- **[M15-2 #10] Lease-coherent CHECK asymmetry.** `transfer_job_items_lease_coherent` requires `worker_id IS NOT NULL` in leased states; `generation_job_pages_lease_coherent` + `regeneration_jobs_lease_coherent` don't. Scope: tighten M3/M7 CHECKs after verifying no orphan-leased rows in production.
- **[M15-2 #12] `image_usage` RLS excludes viewer.** See [M15-4 #8] grouping above — same theme.
- **[M15-2 #13, #14] Service-role-only write tables + `opollo_config` read — undocumented at the migration level.** Intentional (workers use service-role; `first_admin_email` protected from enumeration) but the reasoning lives only in commit history. Scope: one-line comment blocks in each migration.

#### Test coverage (opportunistic — add when touching the surface)

- **[M15-6 #5-12] Route handler tests not written.** Remaining after M15-7 Phase 3 (which covered chat, tools, wordpress):
  - `cron/process-batch` route handler (lib-level well-covered)
  - `cron/process-transfer` (overlaps [M15-5 #1]; test only after cron decision)
  - `cron/budget-reset` route handler
  - `cron/process-regenerations` — only WP_CREDS_MISSING branch covered
  - `ops/self-probe` (no test at all)
  - `sites/[id]` PATCH/DELETE
  - `admin/images/[id]` + `/restore`
  - `admin/sites/[id]/pages/[pageId]` PATCH
- **[M15-6 #13] 6 of 7 tool JSON schemas untested.** `lib/tool-schemas.ts` — `searchImagesJsonSchema` tested; others aren't. Scope: parametric tests across all 7.
- **[M15-6 #14] Tool lib implementations untested.** `lib/create-page.ts`, `lib/update-page.ts`, `lib/delete-page.ts`, `lib/get-page.ts`, `lib/list-pages.ts`, `lib/publish-page.ts`. M15-7 Phase 3b (#134) pins delegation at the route layer; the libs themselves wrap WP + Supabase calls with no dedicated tests. Scope: 2-3 hours per lib.
- **[M15-6 #15] `briefs-review.spec.ts` upload→parse→commit E2E is `test.fixme`.** Blocked on M12-6 save-draft. Re-enable when M12-6 lands.
- **[M15-6 #17] `health-route.test.ts` only covers happy path.** Degraded branches untested. Scope: 1 hour.

#### Tech-debt (bundled cleanup, no urgency)

- **[M15-4 #14] 12 local `errorJson()` helpers across route files.** Migration to `lib/http.respond()` / `lib/http.validationError()` incomplete. Large mechanical diff.
- **[M15-4 #15] 7 copies of `constantTimeEqual` across cron + ops routes.** Move to `lib/http.ts` or `lib/crypto-compare.ts`.
- **[M15-4 #16] `"INVALID_STATE"` error code in `admin/batch/[id]/cancel` not in `ERROR_CODES` enum** (`lib/tool-schemas.ts`). Add to enum or rename to existing code.
- **[M15-4 #17] `admin/sites/[id]/budget` admin-only while siblings allow admin+operator.** Probably intentional (financial); needs one-line comment.
- **[M15-4 #18] `/api/health` envelope outlier** — no `ok` field. Document the deviation in a route comment or align.
- **[M15-4 #19] `/api/health` no outer try/catch.** If a helper throws (vs returning error-shaped), 500 is unstructured. Wrap.
- **[M15-5 dead code] `lib/class-registry.ts`, `lib/content-schemas.ts`, `lib/supabase.ts#getAnonClient`.** Tested/scaffolded but not wired. Scope: per-module decision — ship the feature they were preparing, or delete. Triggers: class-registry unblocks a planned per-component CSS gate; content-schemas unblocks structured inline-HTML; getAnonClient unblocks a planned Stage-2 client-surface.
- **[M15-2 #2 residue] `brief_runs` + `site_conventions`** — M12-1 forward-looking tables, not referenced in production code today. Close naturally when M12-2+ wires them. Comment at migration 0013 noting the forward intent would help.
- **[M15-2 #11 residue] Dynamic update spreads** (`updateDesignSystem`, `updateComponent`, `updateTemplate`). Zod↔DB sync test in #129 guards against drift; the pattern itself is unchanged. Full resolution lands with M15-8 type generation.

#### Env + doc polish (trivial, opportunistic)

- **[M15-3 #6] `NEXT_PUBLIC_VERCEL_ENV` not auto-exposed by Vercel.** Client-side Sentry env tag falls back to `NODE_ENV` on previews. Scope: either set explicitly in Vercel dashboard, or pipe `VERCEL_ENV` through `next.config.mjs` `env:` block.
- **[M15-3 #10] `LEADSOURCE_WP_USER` / `LEADSOURCE_WP_APP_PASSWORD` undocumented format.** WP Application Password (24-char hyphen-separated), NOT the regular WP login password. Add 3-line comment in `.env.local.example`.
- **[M15-3 #11] `SENTRY_ORG` / `SENTRY_PROJECT` undocumented context.** They're only needed at build-time for source-map upload; runtime Sentry works without them. Add inline comment in `.env.local.example`.
- **[M15-3 #12] `DATABASE_URL` shell variable vs `SUPABASE_DB_URL` runtime env naming collision.** RUNBOOK uses `$DATABASE_URL` for CLI; Vercel workers use `SUPABASE_DB_URL`. Add a one-line callout in RUNBOOK's migration section clarifying the distinction.
- **[M15-3 #13] `ANALYZE` env var undocumented.** Only relevant to `npm run analyze`. Low priority.
- **[M15-5 Langfuse EU drift.** `lib/langfuse.ts:37` defaults to `https://us.cloud.langfuse.com`. EU projects without `LANGFUSE_HOST` silently go to the wrong datacenter. Not affected today (we're on US). Close when the `.env.local.example` comment ever needs updating anyway.

#### Closed by M15-8 (future milestone — type generation + CI gates)

- **[M15-2 #1] No generated `types/supabase.ts`.** M15-8 scope.
- **[M15-3 #14] No CI gate between `process.env.X` usage and `.env.local.example`.** M15-8 scope.

### Triggers — summary

| Section | Pick-up trigger |
|---|---|
| Operational decisions | Steven's one-line DB query + decision call |
| Security / auth tightening | Next security review pass OR external auth-gap finding |
| Observability + write-safety hygiene | Next defense-in-depth slice (bundle #5 + #6 + #7 + #12 together) |
| Rate-limiting coverage | Next rate-limit slice (bundle #9 alone) |
| Schema + constraint polish | Next migration slice that naturally touches the same tables |
| Test coverage | Opportunistic — whenever touching the surface |
| Tech-debt | Batched into a periodic "tech-debt PR" — no urgency per item |
| Env + doc polish | Opportunistic — when touching `.env.local.example` or `RUNBOOK.md` for other reasons |
| M15-8 closures | Next M15-8 milestone (type generation, env CI gate) |

---

## M11 — audit close-out (reconciled post-merge)

Parent plan: `docs/plans/m11-parent.md`. Originally scoped as six sub-slices closing every concrete gap surfaced by `docs/AUDIT_2026-04-22.md`. Audit 3 (`docs/plans/m11-parent.md` re-verified against code) found that the M11-6 doc slice landed "merged" rows for M11-2, M11-3, and M11-5 **without** the corresponding code PRs ever shipping. The table below reflects ground-truth after the post-audit reconciliation (PRs #88, #94, #96).

| Slice | Status | Notes |
| --- | --- | --- |
| M11-1 | merged (#87) | Chat route routed through `lib/logger` + new `traceAnthropicStream()` Langfuse wrapper. `e2e/chat.spec.ts` covers the streaming UI contract. |
| M11-2 | merged (#88) | DS_ARCHIVED + WP_CREDS_MISSING regeneration-branch tests. Added optional `buildSystemPrompt` DI param to `processRegenJobAnthropic` so the DS_ARCHIVED branch is unit-test reachable; WP_CREDS_MISSING covered by calling the real GET handler against a seeded credentials-less site. |
| M11-3 | superseded by M11-7 | Audit 3 found the probe absent from `app/api/health/route.ts`. M11-7 implements `checkBudgetResetBacklog()` in `lib/health-checks.ts` + `lib/__tests__/health-budget-reset.test.ts` covering the stuck-row, fresh-row, and sample-cap invariants. |
| M11-4 | merged (#90) | 500KB HTML cap enforced as a quality gate (`gateHtmlSize`) in addition to the render-side cap. Shared constant `HTML_SIZE_MAX_BYTES` in `lib/html-size.ts`. |
| M11-5 | shipping in #96 | `e2e/budgets.spec.ts` — four tests against the pre-seeded E2E site (badge render + invalid-input guard + valid PATCH round-trip + stale-version 409). Replaces the previously-false "merged" claim from M11-6. |
| M11-6 | merged (#92), doc-drift corrected | Retroactive parent plans for M1, M2, M3, M9, M10 added under `docs/plans/`. The "merged" rows this slice originally wrote for M11-2/3/5 were unsubstantiated; Audit 3 caught the drift and this entry is the correction. Process learning: retroactive-planning slices must verify, not declare. |
| M11-7 | this entry | Launch-blocker fixes from Audit 3: `checkBudgetResetBacklog()` probe for real (closes M11-3) + `LEADSOURCE_FONT_LOAD_HTML` prefix on both publishers so generated pages actually load the three spec fonts (closes Audit 3 Finding #2). |

No new env vars.

### Audit 3 polish backlog

Medium / Low findings from Audit 3 (UI + cross-milestone integration) that are deferred — pick up on the next UI polish pass, or earlier if a related slice naturally touches the same surface. Each item is in the `docs/AUDIT_2026-04-22.md` follow-on audit:

- `#7` — `EditPageMetadataModal` no-op submit UX + client-side slug regex (Medium)
- `#8` — `ComponentFormModal` selector-violations list (Medium)
- `#9` — Empty-state CTAs in `DesignSystemsTable` / `ComponentsGrid` (Medium)
- `#10` — `.env.local.example` optional-vars block (Medium)
- `#11` — `<Image>` vs `<img>` decision if admin surfaces ever render images (Medium)
- `#12` — Unify inline validation pattern across modals (Medium)
- `#13` — Brand tokens in Tailwind (Low — only if admin scope changes)
- `#14` — `force-dynamic` vs `revalidate: 0` audit (Low)
- `#15` — Lighthouse thresholds ratchet + `/` route coverage (Low)
- `#16` — Four `: any` annotations in WP + chat boundary (Low)
- `#17` — `docs/PROMPT_VERSIONING.md` vs `lib/prompts/vN/` reconciliation (Low)
- `#18` — Two stale `TODO(M3)` / `TODO(M7)` comments → BACKLOG (Low)
- `#20` — Smart-quote / HTML-entity standardisation in empty states (Low)

Trigger to pick up: next UI polish pass, OR before any admin UI brand-scope change.

### Security audit (2026-04-22 / audit 1 — security & secrets) backlog

All Critical + High findings from the prompt-1 security audit closed by PRs #93 (role gates on design-systems + sites/register), #100 (rate limiting on cost-bearing + auth-adjacent routes), and #102 (server-only guards on node-only lib modules). Finding 6 (.env.local.example drift) closed alongside this entry in the same PR. One Medium deferral:

- **RLS null-safety hardening (Medium, defense-in-depth).** Seven RLS policies across five migration files assume `auth.uid()` is non-NULL for authenticated sessions. PG semantics treat a NULL `USING` clause as not-visible — **no cross-tenant leak today** — but silent denial is the real failure mode during any auth-mechanism cutover. Files:
  - `supabase/migrations/0004_m2a_auth_link.sql:148` — `public.auth_role()` body
  - `supabase/migrations/0005_m2b_rls_policies.sql:112-114` — `opollo_users_self_read`
  - `supabase/migrations/0007_m3_1_batch_schema.sql:125,249,291`
  - `supabase/migrations/0010_m4_1_image_library_schema.sql:490,500,510`
  - `supabase/migrations/0011_m7_1_regeneration_schema.sql:177,229`

  Belt-and-braces prefix: `(auth.uid() IS NOT NULL AND ...) OR public.auth_role() = 'admin'`. **Trigger to pick up:** bundle into the next Supabase Auth migration slice — the one the audit calls "M3 auth migration", i.e. the next-after-M2 auth cutover, naming-ambiguous vs. the already-shipped batch-generator M3. Do NOT ship as a hotfix — the policies do not leak today; landing a belt-and-braces prefix outside a wider migration slice is churn for no live risk.

---

## M10 — observability activation (shipped)

Single-PR activation of the four observability vendors whose env vars were provisioned in Vercel on 2026-04-22: Sentry, Axiom, Langfuse, Upstash Redis. Graceful no-op per vendor when its envs are missing — so preview deployments without the full secret set still function.

| Component | What landed |
| --- | --- |
| Sentry | `instrumentation.ts` / `instrumentation-client.ts` / `sentry.server.config.ts` / `sentry.edge.config.ts` + `withSentryConfig` wrap in `next.config.mjs`. Server + edge + client runtimes gated on `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`. |
| Axiom | Additive transport in `lib/logger.ts`. stdout preserved; Axiom ingest is fire-and-forget with error swallow. |
| Langfuse | `lib/langfuse.ts` singleton + `traceAnthropicCall()` span wrapper. `lib/anthropic-call.ts` wraps every non-chat call; span.fail() on throw, span.end() with tokens on success. Chat surface uses `traceAnthropicStream()` (M11-1) for the streaming path. |
| Upstash Redis | `lib/redis.ts` singleton over `@upstash/redis`. Used by the self-probe for the round-trip check; consumers (rate limiting, prompt cache) land in follow-ups. |
| Self-probe | `POST /api/ops/self-probe` returns per-vendor `{ ok, details/error }` envelope. Auth: admin session OR `OPOLLO_EMERGENCY_KEY` header. |
| Runbook | `docs/runbook/observability-verification.md` — curl command, expected green response, per-vendor troubleshooting, automation snippet. |

New env vars (all optional, no-op when missing): `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `NEXT_PUBLIC_SENTRY_DSN`, `AXIOM_TOKEN`, `AXIOM_DATASET`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `OPOLLO_EMERGENCY_KEY`.

### Observability-deep follow-ups (unblocked)

Now that the vendors are wired, the three deep-integration entries that used to say "blocked on env provisioning" are unblocked:

- **Prompt versioning via Langfuse** (`docs/PROMPT_VERSIONING.md`): move `docs/SYSTEM_PROMPT_v1.md` / `docs/TOOL_SCHEMAS_v1.md` into `lib/prompts/v1/`, wire `resolvePrompt()`, link each `generations_events.anthropic_response_received` to a Langfuse trace. Span wrapper already ships in `lib/anthropic-call.ts`; remaining work is prompt-file relocation + cutover.
- ~~**Rate limiting via Upstash** (`lib/rate-limit.ts`)~~ — shipped in the security-audit follow-up. Named sliding-window buckets (`chat`, `batch`, `regen`, `tools`, `login`, `auth_callback`, `invite`, `register`) wire into cost-bearing and auth-adjacent routes; explicit per-route opt-in, no middleware magic. Fail-open when Upstash is unconfigured or unreachable. **Intentional deferrals still open:** (a) `/api/emergency` is NOT rate-limited — rate-limiting the break-glass route defeats its purpose during an active incident; (b) `/api/health` probe for Upstash reachability is still on the follow-up list; (c) no middleware-level "default 60/min" on every mutating route — opt-in was the explicit preference for audit visibility.
- **Structured log queries via Axiom**: saved searches + alerts for `level:error`, request-id drill-downs, per-slice generation events. Ingest already live; remaining work is dashboard provisioning (operator-facing, not code).

---

## M9 — Next.js 14.2.35 CVE mitigation (shipped)

Single-PR hybrid. See `docs/SECURITY_NEXTJS_CVES.md` for the full matrix. Config-level closure of the three unreachable CVEs (rewrites smuggling, Image Optimizer DoS, next/image disk cache) + documentation of the two partial RSC exposures that remain platform-mitigated on Vercel. Version stays at 14.2.35; the actual 14→16 jump is tracked under "M10-candidate: Next.js 14 → 16 migration" in Infra / observability below.

---

## M8 — per-tenant cost budgets (shipped)

Parent plan: `docs/plans/m8-parent.md`. All five sub-slices merged.

| Slice | Status | Notes |
| --- | --- | --- |
| M8-1 | merged (#79) | `tenant_cost_budgets` schema + auto-create trigger + backfill of existing sites. UNIQUE on site_id. |
| M8-2 | merged (#80) | Enforcement in `createBatchJob` + `enqueueRegenJob`. `SELECT … FOR UPDATE` + atomic usage increment via `lib/tenant-budgets.ts`. BUDGET_EXCEEDED on overdraw. |
| M8-3 | merged (#81) | iStock seed (M4-5) integration — `ISTOCK_SEED_CAP_CENTS` env ceiling; effective cap = min(caller, env); `capSource` threaded through result + error. |
| M8-4 | merged (#82) | `/api/cron/budget-reset` hourly reset cron. Daily + monthly rollover via single UPDATE per period with `WHERE reset_at < now()` predicate. Idempotent under concurrent ticks. |
| M8-5 | merged (#83) | Admin UI budget badge on `/admin/sites/[id]` + PATCH endpoint with version_lock. |

~~New env vars (both optional, code-side defaults apply): `DEFAULT_TENANT_DAILY_BUDGET_CENTS` (default 500 = $5/day), `DEFAULT_TENANT_MONTHLY_BUDGET_CENTS` (default 10000 = $100/month).~~ **2026-04-24 (M15-3):** these env vars were never wired. The M8-1 migration hardcodes the column defaults (500 / 10000); no code reads the env var. Changing the baseline requires a forward migration. Entries also removed from `.env.local.example`.

---

## M7 — single-page re-generation (shipped)

Parent plan: `docs/plans/m7-parent.md`. Write-safety-critical milestone; all five sub-slices merged.

| Slice | Status | Notes |
| --- | --- | --- |
| M7-1 | merged (#72) | `regeneration_jobs` + `regeneration_events` schema with partial UNIQUE + lease-coherence CHECK + RLS. |
| M7-2 | merged (#73) | Worker core (lease / heartbeat / reaper) + Anthropic integration + event-log-first billing + VERSION_CONFLICT short-circuit. |
| M7-3 | merged (#75) | WP update stage with drift reconciliation + M4-7 image transfer + `pages.version_lock` bump. |
| M7-4 | merged (#77) | Admin UI: "Re-generate" button + status polling panel + enqueue endpoint with REGEN_ALREADY_IN_FLIGHT guard. |
| M7-5 | merged (#78) | Cron wiring (`/api/cron/process-regenerations`) + daily budget cap (`REGEN_DAILY_BUDGET_CENTS` env → `BUDGET_EXCEEDED`) + retry/backoff via `retry_after`. Backoff values live in the `REGEN_RETRY_BACKOFF_MS` code constant in `lib/regeneration-worker.ts`, not an env var. |

No new env vars — every external dependency (`ANTHROPIC_API_KEY`, `CLOUDFLARE_*`, `OPOLLO_MASTER_KEY`, `CRON_SECRET`) is already provisioned from M3 + M4.

---

## M6 — per-page admin surface (shipped)

Parent plan: `docs/plans/m6-parent.md`. All four sub-slices merged.

| Slice | Status | Notes |
| --- | --- | --- |
| M6-1 | merged (#68) | `/admin/sites/[id]/pages` list + `lib/pages.ts` data layer + Pages link on site detail. |
| M6-2 | merged (#69) | `/admin/sites/[id]/pages/[pageId]` detail + Tier-2 static preview + Tier-3 WP admin link. |
| M6-3 | merged (#70) | Metadata edit modal (title + slug) + `PATCH /api/admin/sites/[id]/pages/[pageId]` with version_lock + UNIQUE_VIOLATION. |
| M6-4 | merged (#71) | UX-debt cleanup: de-jargon the design-system authoring forms per CLAUDE.md backlog. |

No new env vars.

---

## M5 — image library admin UI (shipped)

Parent plan: `docs/plans/m5-parent.md`. All four sub-slices merged.

| Slice | Status | Notes |
| --- | --- | --- |
| M5-1 | merged (#64) | `/admin/images` list page + `lib/image-library.ts` data layer + nav link. |
| M5-2 | merged (#65) | `/admin/images/[id]` detail page with `image_usage` + `image_metadata` panes. |
| M5-3 | merged (#66) | Metadata edit modal + `PATCH /api/admin/images/[id]` with `version_lock`. |
| M5-4 | merged (#67) | Soft-delete + restore with `IMAGE_IN_USE` guard. |

No new env vars — every Cloudflare secret needed for thumbnails is already provisioned from M4.

---

## M4 — image library (shipped)

Parent plan: `docs/plans/m4.md`. All seven sub-slices merged.

| Slice | Status | Notes |
| --- | --- | --- |
| M4-1 | merged (#57) | Schema: 6 tables + constraints + RLS + FTS trigger. |
| M4-2 | merged (#58) | Worker core (lease / heartbeat / reaper over `transfer_job_items` + dummy processor). |
| M4-3 | merged (#61) | Cloudflare upload worker stage + orchestrator. |
| M4-4 | merged (#59) | Anthropic vision captioning (reuses `ANTHROPIC_API_KEY`). |
| M4-5 | merged (#62) | iStock seed script: CSV ingest + dry-run + budget cap. |
| M4-6 | merged (#60) | `search_images` chat tool. |
| M4-7 | merged (#63) | WP media transfer + HTML URL rewrite on publish. |

Env vars: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_IMAGES_API_TOKEN`, `CLOUDFLARE_IMAGES_HASH` all provisioned in Vercel Production + Preview as of 2026-04-21.

---

## Infra / observability

### Enable GitHub Actions to create pull requests (blocks release-please)
**What:** repo setting at `Settings → Actions → General → Workflow permissions` → check **"Allow GitHub Actions to create and approve pull requests"**. One click; no code change.
**Why blocked today:** `.github/workflows/release-please.yml` runs correctly after PR #106 fixed the config filename — it processes all 240 main commits, computes `0.1.0 → 0.1.1`, pushes the release branch — then fails on the last step when it tries to open the Release PR. The default `GITHUB_TOKEN` is denied PR creation unless this setting is flipped.
**Error signature (so future-me doesn't re-diagnose):**
```
release-please failed: GitHub Actions is not permitted to create or
approve pull requests. - https://docs.github.com/rest/pulls/pulls#create-a-pull-request
```
**Alternatives considered:** a PAT secret with `repo` scope would also unblock it, but costs a token to rotate and adds a single point of failure. The repo-setting flip is one-time, auditable, and uses the ambient `GITHUB_TOKEN`.
**Trigger to pick up:** Steven flips the setting. After that, the next push to main will open the first Release PR (0.1.0 → 0.1.1). No code changes needed on our side.
**Scope:** zero code; post-flip verification is `gh run list --workflow=release-please.yml --limit 1` showing a green run.

### ~~Fix Lighthouse CI first-run failure~~ (diagnosed + shipped in the patterns PR)
**Original symptom:** `lhci` failing recurrently on PR #52 and PR #53 despite two rounds of patching.
**Root cause:** `lighthouse:recommended` preset brings in many **error-level** assertions (render-blocking-resources, legacy-javascript, third-party-summary, etc.) that my explicit warn-level overrides didn't touch. Those error-level assertions fired on a minimal login page and caused `lhci autorun` to exit 1.
**Fix shipped:** dropped the preset from `lighthouserc.json`; explicit assertions only, all warn-level. Also made the workflow step `continue-on-error: true` with artifact upload so future regressions preserve the reports without blocking merge. Kept the earlier fixes (relaxed ready pattern, placeholder envs, chromeFlags array, explicit server bind, 120s timeout).

### ~~Next.js framework upgrade (14.2.15 → patched release)~~ (partially shipped in M9; blocking fix deferred as M10-candidate)
**Status:** the original plan ("bump to 14.2.28+, stay on 14.x") was incompatible with the actual npm advisory state — no 14.x patch release exists for the five CVEs, and they all ship fixed only in `next@16.2.4+`. M9 (#TBD) landed the hybrid mitigation: explicit config-level closure of the three unreachable CVE surfaces + documentation of the two partial (RSC) exposures which remain platform-mitigated on Vercel. See `docs/SECURITY_NEXTJS_CVES.md` for the full per-CVE matrix. Threshold in `.github/workflows/audit.yml` stays at `critical` until the actual version jump lands.

### M10-candidate: Next.js 14 → 16 migration (multi-day effort)
**What:** bump `next` from `14.2.35` to `16.2.4+` to apply fixes for GHSA-9g9p-9gw9-jx7f, GHSA-h25m-26qc-wcjf, GHSA-ggv3-7p47-pfv8, GHSA-3x4c-7xq6-9pq8, GHSA-q4gf-8mx6-v5v3 at the code layer rather than the config layer.
**Why a separate milestone:** known breaking-change surfaces in our codebase require deliberate migration:
  - `middleware.ts` — `@supabase/ssr` cookie-refresh pattern changed between Next 14 and 15; copyAuthCookies flow needs re-verification.
  - `app/**/page.tsx` — `params` and `searchParams` became Promises in 15.x. 20+ admin pages need async-unwrap refactoring.
  - `lib/security-headers.ts` — CSP-nonce injection API shifted (next/headers returns Promise in 15.x).
  - `next/image` is unused today but the `images.unoptimized: true` + `remotePatterns: []` config added in M9 may need re-verification against the 16.x image config shape.
  - ESLint / React / Radix dependency cascade — `eslint-config-next` pin follows `next` major; expect tool-config churn.
**Trigger to pick up:** any of (a) we move off Vercel and lose the platform-layer RSC mitigations (M9's SECURITY_NEXTJS_CVES.md calls this a blocker), (b) a sixth Next.js CVE surfaces that we can't mitigate at config layer, (c) Steven batches a framework-upgrade window.
**Scope:** ~3-5 focused sub-slices. Expected order: (1) dependency bump + eslint/typing fixes, (2) async params migration across admin pages, (3) middleware + CSP/nonce re-verification, (4) full E2E regression sweep, (5) tighten `audit.yml` threshold to `high`.
**After it lands:** strike through SECURITY_NEXTJS_CVES.md + the M9 BACKLOG entry above.

### Schema hygiene pass: soft-delete + audit columns
**What:** add `deleted_at` / `deleted_by` / `created_at` / `updated_at` / `created_by` / `updated_by` across mutable tables (`sites`, `design_systems`, `design_components`, `design_templates`, `pages`) per `docs/DATA_CONVENTIONS.md`.
**Why deferred:** schema-level change against every existing row. Needs per-table backfill plan + RLS policy updates + row-level test coverage.
**Trigger:** next natural migration that touches any of these tables. Piggyback rather than dedicate.
**Scope:** one sub-PR per table family; 200–400 lines each including tests. Can be worked in parallel once the plan for any one table is reviewed.

### ~~Langfuse wiring~~ (shipped in M10)
Client + span wrapper in `lib/langfuse.ts`; `lib/anthropic-call.ts` wraps every non-chat call, and `traceAnthropicStream()` covers the chat streaming path (M11-1). Prompt-versioning cutover still pending — tracked under M10 follow-ups above.

### ~~Sentry wiring~~ (shipped in M10)
`instrumentation.ts` / `sentry.server.config.ts` / `sentry.edge.config.ts` / `instrumentation-client.ts` + `withSentryConfig` wrap in `next.config.mjs`. No-op without DSN.

### ~~Axiom log shipping~~ (shipped in M10)
Additive transport inside `lib/logger.ts`. stdout preserved for Vercel log streams + local dev; Axiom ingest is fire-and-forget.

### ~~Upstash Redis~~ (shipped in M10 as client only; rate-limit adapter shipped in security audit follow-up)
`lib/redis.ts` singleton available via `getRedisClient()`. `lib/rate-limit.ts` adapter is live as of the security-audit Step 2 slice — named sliding-window buckets with explicit per-route opt-in. See the M10 follow-ups section above for scope + intentional deferrals.

### CSP enforce-mode migration (nonces)
**What:** flip `Content-Security-Policy-Report-Only` to enforced. Requires per-request nonce injection via middleware → `next/headers` → inline `<script nonce>` in templates.
**Why deferred:** Next.js 14 App Router migration is non-trivial; collecting real browser violation data in report-only mode first.
**Trigger:** after a few weeks of clean report-only traffic + after the Next.js upgrade (some nonce APIs changed across 14.x patches).
**Scope:** middleware + layout + ~8 page updates.

### ~~Per-tenant cost budgets~~ (shipped in M8, PRs #79-#83)
Full milestone landed as M8-1 through M8-5 — `tenant_cost_budgets` schema + auto-create trigger, enforcement in `createBatchJob` + `enqueueRegenJob`, iStock seed integration, hourly reset cron, admin UI budget badge + PATCH endpoint. See the M8 section above for the slice-by-slice breakdown.

### ~~Anthropic pricing-table scale audit~~ (shipped PR #124)
Rate table in `lib/anthropic-pricing.ts` reconciled with the units convention stated in its own header. Fixture test in `lib/__tests__/anthropic-pricing.test.ts` pins "1M Opus tokens at $15 → 1500 cents" so future drift fails loudly at the unit layer. Unblocks the M8-5 budget badge as a trustworthy per-$ consumer of `computeCostCents`.

---

## Testing

### ~~Investigate pre-existing E2E failures on main (sites + users + images specs)~~ (shipped PR #76 + PR #125)
All three locator regressions fixed in PR #76 (sites / users / images spec narrowing + networkidle wait on the archive flow). E2E promoted from non-required to required branch-protection check in PR #125 — silent drift of the kind that let these three tests sit red for weeks is no longer possible; a red spec now blocks merge.

### Load testing (k6 / Artillery)
**What:** scripted soak tests against the batch worker + chat route.
**Why deferred:** need real traffic shape to model. Synthetic load without a baseline produces noise.
**Trigger:** first month of paying customers, or when the batch worker's throughput numbers are in question.
**Scope:** k6 scripts for (a) batch-create under contention, (b) chat route sustained RPS, (c) reaper behaviour under lease expiry flood.

### Chaos engineering
**What:** deliberate failure injection — kill the database mid-batch, drop network between worker and Anthropic, corrupt a page of WP credentials.
**Why deferred:** builds confidence once the system is in production with real SLAs. Premature on a greenfield.
**Trigger:** first production SLA commitment.
**Scope:** per-scenario runbook + failure injection script + post-recovery assertions.

### Synthetic monitoring (Checkly / Uptime Robot)
**What:** external probe of `/api/health` every N minutes, alerts on 503.
**Why deferred:** Vercel's own uptime monitoring covers the 80% case for free. Checkly's depth isn't earning its keep yet.
**Trigger:** first incident where Vercel's native monitoring missed a degraded state.
**Scope:** Checkly account + checks for `/api/health`, `/login` render, one admin route behind a test session.

### Property-based / fuzz testing
**What:** `fast-check` arbitraries against the hot paths — scope-prefix generation, CSS / HTML class extractors, slug sanitisation, quality gate runners.
**Why deferred:** the existing example-based tests cover the known-bad inputs. Property-based testing is valuable once the hot path sees real user-supplied input.
**Trigger:** first regression that an example-based test missed, or any new parser / validator.
**Scope:** ~5 arbitraries per hotspot + CI integration.

---

## Developer experience

### size-limit bundle budgets
**What:** `@size-limit/preset-app` + a `.size-limit.json` budget file + CI check.
**Why deferred:** needs a baseline capture first; arbitrary initial budgets fail noisily.
**Trigger:** after two weeks of production usage, capture the rolling-average bundle sizes and set budgets at baseline + 15%.
**Scope:** dep + config + one CI job.

### Storybook
**What:** isolated component workbench.
**Why deferred:** shadcn/ui covers the design-system visual authoring surface; a standalone Storybook instance adds maintenance for marginal gain.
**Trigger:** when a non-engineer (designer / PM) needs to review components without booting the full app.
**Scope:** Storybook install + MDX config + one story per component.

### Feature flags
**What:** Flagsmith / OpenFeature / LaunchDarkly integration for gradual rollouts.
**Why deferred:** the env-var feature flag pattern (`FEATURE_SUPABASE_AUTH` / `FEATURE_DESIGN_SYSTEM_V2` / kill switch via `config` table) is enough for a single-operator product.
**Trigger:** first feature that needs percentage-based rollout, or the first multi-tenant flag scope (per-customer on/off).
**Scope:** SDK + `lib/flags.ts` wrapper + migration of the existing env-var flags.

---

## Product surface

### Stripe billing
**What:** products, prices, subscriptions, webhooks, dunning.
**Why deferred:** no paying customers yet.
**Trigger:** first paying customer is imminent (weeks, not months, out).
**Scope:** ~1–2 weeks of work. Schema: `stripe_customers`, `subscriptions`, `invoices`. Routes: `/api/billing/webhook`, checkout session, customer portal. RLS + per-tenant cost budget integration.

### Admin surface de-jargoning pass (see CLAUDE.md "Backlog — UX debt")
**What:** replace DB-column-name-style labels across design-system authoring forms.
**Why deferred:** design-system authoring is a developer surface; full de-jargoning is lower ROI.
**Trigger:** next PR that touches `TemplateFormModal.tsx` / `ComponentFormModal.tsx` / `CreateDesignSystemModal.tsx`.
**Scope:** label + sub-label changes, no behaviour impact.

---

## Docs

### CHANGELOG.md baseline
**What:** release-please will generate one on the next release. Nothing to do until then.
**Why deferred:** automation pending first release.
**Trigger:** first merge to main after release-please is live.
**Scope:** release-please handles it.

### API reference doc
**What:** per-route OpenAPI spec, generated or hand-authored.
**Why deferred:** single-consumer product; the operator reads the route handlers directly.
**Trigger:** first external integrator wanting to hit the API.
**Scope:** `openapi.json` + `/docs` surface using e.g. Scalar / Redoc.

---

## Deferred dependency upgrades

Major-version dependabot PRs closed because each carries a breaking-change surface that requires a deliberate migration slice, not a drive-by merge. Re-open (or let dependabot reopen on the next refresh) when the migration is scheduled.

| PR | Dependency | Jump | Reason deferred |
| --- | --- | --- | --- |
| #47 | `eslint` | 8.57.1 → 10.2.1 | Flat config (`eslint.config.js`) is the only supported format in v9+; our `.eslintrc` + `eslint-config-next@14` preset don't load under it. Needs a config rewrite + every `eslint-plugin-*` checked for flat-config support. |
| #48 | `typescript` | 5.9.3 → 6.0.3 | Major bump surfaces new strict-mode errors across the codebase (already seeing `baseUrl` deprecation warnings on 5.x). Needs a dedicated pass to fix new diagnostics and re-pin any TS-version-sensitive deps (`ts-node`, `@typescript-eslint/*`). |
| #49 | `tailwindcss` | 3.4.19 → 4.2.3 | v4 is a full rewrite (Oxide engine, new `@import "tailwindcss"` entry, CSS-first config, PostCSS plugin split). Will change the generated CSS for every page we ship to WP, so this is write-safety-adjacent — needs its own slice with visual-diff checks. |
| #50 | `eslint-config-next` | 14.2.35 → 16.2.4 | Pinned to the Next.js major. v16 requires Next.js 16 (we're on 14.x); do this as part of the Next.js framework upgrade, not ahead of it. |

**Trigger to pick up:** a dedicated tooling-upgrade slice (likely alongside the Next.js 14 → 15/16 migration when we decide to ship it). Until then dependabot will keep re-opening; close with the same comment + link back to this entry.

---

## Promotion / demotion log

When an item moves out of here — either because it shipped or because the trigger fired and it became active work — strike through the entry but keep it in history:

```
### ~~Title~~ (shipped 2026-05-15, PR #58)
```

Don't delete; the history of what we deferred and why is part of the engineering record.
