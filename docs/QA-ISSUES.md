# Pre-Release QA Issues Log

Opened: 2026-05-04. Living doc for the pre-release quality sweep.

Format per issue: `[PHASE] [SEVERITY] description — status`
Severity: CRITICAL (blocks ship) | HIGH (fix before merge) | MEDIUM | LOW

---

## Phase 1 — Backlog items

| # | Item | Status |
|---|------|--------|
| P1-1 | Transfer-cron dead code deletion (M15-5 #1) | ✅ Done — PR #527 |
| P1-2 | errorJson() migration to lib/http helpers (M15-4 #14) | 🔄 In progress |
| P1-3 | Lease-coherent CHECK asymmetry M3/M7 (M15-2 #10) | 🔄 In progress |

---

## Phase 2 — Endpoint test coverage

Tracked per route family. Format: route → missing tests.

| Route family | Identified gaps | Status |
|---|---|---|
| (being audited) | | |

---

## Phase 3 — UI/UX audit

| Page | Issue | Status |
|---|---|---|
| (being audited) | | |

---

## Phase 4 — M16 specific checks

| Check | Finding | Status |
|---|---|---|
| Site Plan Review screen | | ⬜ |
| Section Prop Editor | | ⬜ |
| Shared Content Manager | | ⬜ |
| Rendered preview iframe | | ⬜ |
| Validation errors on broken refs | | ⬜ |
| WP publisher Gutenberg block wrap | | ⬜ |

---

## Phase 5 — CSS/styling

| Surface | Issue | Status |
|---|---|---|
| (being audited) | | |

---

## Phase 6 — Final checks

| Check | Result | Status |
|---|---|---|
| npm run typecheck | | ⬜ |
| npm run lint | | ⬜ |
| npm run audit:static | | ⬜ |
| npm run test | | ⬜ |

---

## Phase 7 — Polish

| Surface | Gap | Status |
|---|---|---|
| (being audited) | | |

---

## Decisions required (stop-and-log items)

None yet.
