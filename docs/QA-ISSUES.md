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
| S-4 | `app/company/social/connections/page.tsx` | `connect=sync-failed` banner shows generic "The connection couldn't be completed." — `sync.error.code` (e.g. "INTERNAL_ERROR") isn't in `REASON_LABEL` | Add a `sync-failed` case with "Accounts may be connected but sync is still pending — try Refresh." |
| S-5 | `lib/platform/social/cap/image-trigger.ts:108` | `bytes: 0` hardcoded in `social_media_assets` insert — file size not tracked for CAP images | Expose bytes from `generateWithFallback` or read from Supabase Storage stat after upload |
| S-6 | `components/SocialPostDetailClient.tsx`, `components/PostScheduleSection.tsx` | `window.confirm()` / `window.prompt()` used for destructive actions (delete, submit, cancel-approval, reject, request-changes, schedule-cancel) — native browser dialogs, poor mobile UX | Replace with shadcn/ui `AlertDialog` + a `CommentDialog` (text-input variant); candidate for a dedicated polish slice |
