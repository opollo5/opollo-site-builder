# Pre-Release QA Issues Log

Opened: 2026-05-04. Living doc for the pre-release quality sweep.

Format per issue: `[PHASE] [SEVERITY] description — status`
Severity: CRITICAL (blocks ship) | HIGH (fix before merge) | MEDIUM | LOW

---

## Phase 1 — Backlog items

| # | Item | Status |
|---|------|--------|
| P1-1 | Transfer-cron dead code deletion (M15-5 #1) | ✅ Done — PR #527 |
| P1-2 | errorJson() migration to lib/http helpers (M15-4 #14) | 🔄 Deferred — 60+ files, no urgency, tech-debt backlog |
| P1-3 | Lease-coherent CHECK asymmetry M3/M7/M12 (M15-2 #10) | ✅ Done — migration 0087, PR #541 |

---

## Phase 2 — Endpoint test coverage

| Route family | Identified gaps | Status |
|---|---|---|
| POST /api/admin/batch | No route handler unit test | ✅ Done — PR #541 (16 cases) |
| POST /api/admin/batch/[id]/cancel | No route handler unit test | ✅ Done — PR #541 (11 cases) |
| GET+POST /api/sites/[id]/blueprints | No tests at all | ✅ Done — PR #541 (14 cases) |
| GET+POST /api/cron/drift-detect | No tests | ✅ Done — PR #541 (9 cases) |
| GET+POST /api/cron/render-pages | No tests | ✅ Done — PR #541 (9 cases) |
| GET+POST /api/cron/process-brief-runner | No tests | ✅ Done — PR #541 (9 cases) |

---

## Phase 3 — UI/UX audit

| Page | Issue | Status |
|---|---|---|
| All 38 admin pages | Default exports, nav links, form handlers, imports | ✅ PASS — no issues |
| AdminSidebar nav links | All hrefs resolve to real page.tsx files | ✅ PASS |
| Shadcn imports | All from @/components/ui/... | ✅ PASS |
| Loading states | Skeleton components present on async Client pages | ✅ PASS |

---

## Phase 4 — M16 specific checks

| Check | Finding | Status |
|---|---|---|
| Site Plan Review screen | Full wiring: loads blueprint, renders routes/content, approve/revert | ✅ PASS |
| Section Prop Editor | Not built — intentional; sections are immutable post-render | ✅ By design |
| Shared Content Manager | Full CRUD with version_lock optimistic concurrency | ✅ PASS |
| Rendered preview iframe | path-B fragment wrapping with shim CSS, fullscreen mode | ✅ PASS |
| Validation errors on broken refs | Silently omitted (ref-resolver is pure data transform, documented) | ✅ By design |
| WP publisher Gutenberg block wrap | `<!-- wp:html -->` wrapping in lib/gutenberg-format.ts | ✅ PASS |
| Blueprint approval gate | brief-runner returns awaiting_blueprint_approval until approved | ✅ PASS |

---

## Phase 5 — CSS/styling

| Surface | Issue | Status |
|---|---|---|
| M16 screens (blueprints/review, content) | All Tailwind + shadcn, no hardcoded colors/px | ✅ PASS |
| opollo-components.css vs preview-iframe-wrapper.ts | --ds-* names in shim ≠ --opollo-* in tokens file | ✅ Not a bug — shim uses hardcoded fallback values by design (documented, deferred for high-fidelity preview follow-up) |
| Button/interaction states | All via shadcn Button component with built-in transitions | ✅ PASS |
| Empty HTML elements without classes | None found | ✅ PASS |

---

## Phase 6 — Final checks

| Check | Result | Status |
|---|---|---|
| npm run typecheck | 0 errors | ✅ PASS |
| npm run lint | 0 warnings | ✅ PASS |
| npm run audit:static | 0 HIGH, 45 MEDIUM (all pre-existing false positives), 53 LOW | ✅ PASS |
| npm run test | Pre-existing CI timeout (>25min test suite) — not caused by this sweep | ⚠️ Pre-existing |

---

## Phase 7 — Polish

| Surface | Gap | Status |
|---|---|---|
| Blueprint review empty state | Bare `<p>` → replace with EmptyState component | ✅ Fixed — PR #542 |
| Shared content empty state | Bare `<p>` → replace with EmptyState component | ✅ Fixed — PR #542 |
| Transitions/animations | All buttons use shadcn transition-smooth, nav uses transition-smooth | ✅ PASS |
| Spacing/typography consistency | max-w-4xl, text-2xl/text-lg/text-sm hierarchy consistent | ✅ PASS |
| Skeleton loaders | Blueprint review + content page both have Skeleton rows | ✅ PASS |

---

## Decisions required (stop-and-log items)

None — all decisions were resolvable autonomously.

---

## Social platform QA — 2026-05-04

Full audit of `app/company/social/**`, `lib/platform/social/**`, cron routes,
components, and webhooks. Typecheck ✓ Lint ✓. Tests require Docker (not run).

### Fixed in PR #TODO (feat/social-platform-qa)

| # | File | Issue | Fix |
|---|------|-------|-----|
| S-1 | `app/company/social/posts/[id]/page.tsx` | `PostScheduleSection` only rendered for `state="approved"`; the `claim_publish_job` RPC accepts both `approved` and `scheduled` — schedule entries would be invisible if state ever transitions to `scheduled` | Extended condition to `"approved" \|\| "scheduled"` |
| S-2 | `components/SocialPostDetailClient.tsx` | No success feedback after approve/reject/request-changes/release/submit/reopen/cancel/duplicate — only silent `router.refresh()` | Added `toast.success(…)` via sonner after each successful action |
| S-3 | `components/SocialConnectionsList.tsx` | `window.location.reload()` on sync success — hard reload, loses scroll position | Replaced with `router.refresh()` + `toast.success("Connections refreshed.")` |

### Logged as debt (not fixed)

| # | File | Issue | Suggested fix |
|---|------|-------|---------------|
| S-4 | `app/company/social/connections/page.tsx` | `connect=sync-failed` banner shows generic "The connection couldn't be completed." — `sync.error.code` (e.g. "INTERNAL_ERROR") isn't in `REASON_LABEL` | ✅ Fixed — PR #546 |
| S-5 | `lib/platform/social/cap/image-trigger.ts:108` | `bytes: 0` hardcoded in `social_media_assets` insert — file size not tracked for CAP images | Expose bytes from `generateWithFallback` or read from Supabase Storage stat after upload |
| S-6 | `components/SocialPostDetailClient.tsx`, `components/PostScheduleSection.tsx` | `window.confirm()` / `window.prompt()` used for destructive actions (delete, submit, cancel-approval, reject, request-changes, schedule-cancel) — native browser dialogs, poor mobile UX | Replace with shadcn/ui `AlertDialog` + a `CommentDialog` (text-input variant); candidate for a dedicated polish slice |

---

## Site-builder broad sweep — 2026-05-04

Full audit of auth, admin API routes, cron routes, chat route, `lib/batch-publisher.ts`,
`lib/brief-runner.ts`, `lib/rate-limit.ts`, `lib/encryption.ts`, migration history,
and component-level code paths. Typecheck ✓ Lint ✓.

### Fixed in PR #546 + PR #548 (fix/site-builder-qa-sweep, fix/cron-auth-dedup-optimiser)

| # | File | Issue | Fix |
|---|------|-------|-----|
| B-1 | `lib/generator-payload.ts` | `console.warn` in production code path — bypasses structured logger, won't reach Axiom, no request ID attached | Replaced with `logger.warn(...)` |
| B-2 | `app/api/cron/drift-detect/route.ts` | Local inline `constantTimeEqual` duplicating `@/lib/crypto-compare` — maintenance risk if shared impl ever gets a fix | Removed inline copy, import from shared module |
| B-3 | `app/api/cron/render-pages/route.ts` | Same as B-2 | Removed inline copy, import from shared module |
| B-4 | `app/company/social/connections/page.tsx` | `?connect=sync-failed` banner fell through to generic error message (S-4 from social sweep) | Added explicit amber warning: "Accounts may be connected but sync is still pending — try Refresh." |
| B-6 | `lib/optimiser/sync/cron-shared.ts` | Same inline `constantTimeEqual` copy — 13 optimiser cron routes share this file, so all were affected | Removed inline copy, import from `@/lib/crypto-compare` |

### No issues found (areas confirmed clean)

| Area | Files reviewed | Result |
|---|---|---|
| Auth architecture | `lib/auth.ts`, `middleware.ts`, `lib/admin-gate.ts`, `lib/encryption.ts` | ✅ Clean |
| Chat route | `app/api/chat/route.ts` | ✅ Clean — rate-limited, auth-gated, no tool injection, SSE error redaction correct |
| Batch publisher | `lib/batch-publisher.ts` (527 lines) | ✅ Clean — advisory lock, SAVEPOINT adoption, idempotent WP GET-first |
| Cron auth (all 24 routes) | Bearer CRON_SECRET via `@/lib/crypto-compare` (now consistent) | ✅ Clean |
| Admin API routes | Sites, register, users, batch — all use `requireAdminForApi` gate, Zod validation, structured logger | ✅ Clean |
| Rate limiting | `lib/rate-limit.ts` | ✅ Clean — fail-open semantics, all sensitive routes covered |
| Migration history | 0001–0087 | ✅ Clean — sequential, soft-delete consistent |
| `console.log` in production paths | All lib + app .ts/.tsx | ✅ Only `emergency/route.ts` (intentional, documented) and `logger.ts` sink (intentional) |

### Logged as debt (not fixed)

| # | File | Issue | Suggested fix |
|---|------|-------|---------------|
| B-5 | `lib/brief-runner.ts:2507,2628` | `projectedIterationCostCents = 10`, `projectedRevCostCents = 15` hardcoded — will drift from actual model pricing | Move to a named constant or config table; recalibrate against Sonnet pricing |
| B-7 | `lib/system-prompt.ts:44–55` | `replaceAll` template substitution: if `site_name` contains a later template token (e.g. `{{prefix}}`), it double-expands — prompt injection by a trusted admin | Low risk (admin-only), but validate `site_name` doesn't contain `{{...}}` in `RegisterSiteInputSchema` / `UpdateSiteBasicsSchema` |
| B-8 | `app/api/approve/[token]/decision/route.ts` | No rate limiter on public token endpoint — 256-bit entropy makes brute-force infeasible, but defence-in-depth gap | Add `checkRateLimit("invite_accept", ...)` per-IP as used on the invitation accept endpoint |
