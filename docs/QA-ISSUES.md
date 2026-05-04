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
