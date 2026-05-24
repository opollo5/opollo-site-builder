# Social-01 Audit — Decision Trail & Assumptions

**Date:** 2026-05-20

This document records audit assumptions, ambiguities resolved, and investigative decisions made during the Phase 0/1 audit. Referenced from COMPLETE_AUDIT.md.

---

## A1 — "Migrations 0128-0130 missing" classification

**Assumption:** The brief referenced migrations 0127-0135 as a contiguous range. Migrations 0128, 0129, 0130 do not exist.

**Investigation:** Ran `glob("supabase/migrations/012*.sql")` — confirmed 0127 jumps directly to 0131. Checked the actual content of 0127, 0131, 0132, 0133, 0134, 0135 — all are coherent and self-contained. None of them reference missing predecessors.

**Resolution:** Classified as MISSING but informational. Migration numbers are internal identifiers; gaps are harmless. The schema is complete because all 11 extra columns required by the brief are present across the 6 migrations that do exist. This is NOT a functional gap — it is a numbering artifact from how the implementation agent assigned migration numbers (possibly three early migrations were written and then superseded/dropped before commit).

---

## A2 — Cron path prefix deviation

**Assumption:** The brief (BUILD_ORDER.md) described cron handlers at `/api/cron/heartbeat-check`, `/api/cron/cleanup-cache`, etc.

**Investigation:** `ls app/api/cron/` showed no such routes. Searched `vercel.json` — found the 6 expected handlers registered at `/api/internal/cron/*`. Checked `app/api/internal/cron/` — all 6 routes present.

**Resolution:** This is an intentional path deviation (agent chose `/api/internal/cron/` to signal these are internal cron endpoints not exposed publicly). Consistent with vercel.json registration. Classified as WORKING with a deviation note.

---

## A3 — Approval token route path deviation

**Assumption:** The brief said the approval token route would be at `app/api/platform/social/approval/[token]`.

**Investigation:** `glob("app/api/platform/social/approval/**")` returned nothing. Searched `grep -rn "approval.*token"` across `app/api/` — found `app/api/approve/[token]/decision/route.ts`.

**Resolution:** Route exists at a different path (`/api/approve/[token]/decision` vs `/api/platform/social/approval/[token]`). Functionally equivalent. The public `/review/[token]` page calls this route via `ReviewDecisionForm`. Classified as WORKING with path deviation note.

---

## A4 — `/social/poster` unreachable classification

**Assumption:** The brief specified PR F would create the dashboard at `/social/poster`. The page exists.

**Investigation:**
1. Read `app/(platform)/social/poster/page.tsx` — exists, imports CalendarShell, has no redirect from `/company/social/*`.
2. Searched `grep -rn "/social/poster"` across all `.tsx`/`.ts`/`.json` production files excluding docs/e2e — found zero navigation links. Only the page file itself references the path.
3. Searched navigation components — no menu, sidebar, or nav link points to `/social/poster`.
4. E2e tests (`dashboard.spec.ts`, `bulk-csv.spec.ts`, `analytics.spec.ts`) navigate to `/social/poster` directly by URL.

**Resolution:** The route is deployed but has no navigation entry point. From a user perspective it is effectively unreachable unless they know the URL. This is a HIGH priority gap because it means the PR F/G/H features (CalendarShell, bulk upload, analytics modal) are not discoverable.

**Hypothesis for how this happened:** The social-01 brief planned `/social/poster` as the primary social route. The existing customer-facing social route is `/company/social/calendar`. During implementation, both routes were built separately — the brief's new route at `/social/poster` and the existing route at `/company/social/calendar` were never reconciled. The nav menus were not updated to point to the new route.

---

## A5 — Dual calendar implementation classification

**Assumption:** The brief described one CalendarShell implementation. Two exist.

**Investigation:**
1. `grep "CalendarShell|SocialCalendarClient" app/` — found two separate page.tsx files importing different components.
2. Read both components fully. `SocialCalendarClient` (simpler) at `/company/social/calendar` — no DnD, no day-detail, no BulkScheduleModal, no PostAnalyticsModal. `CalendarShell` (full) at `/social/poster` — all features.
3. The primary social navigation links in the existing app point to `/company/social/calendar` (this can be inferred from the `/company/social/*` layout and the nav structure).

**Resolution:** `SocialCalendarClient` is a pre-existing lite calendar that was never replaced. `CalendarShell` is the new full calendar from social-01 but was placed at a new route instead of replacing the existing route. Both coexist. This is a HIGH priority gap.

---

## A6 — Dual webhook route classification

**Assumption:** Only one bundle.social webhook route should exist.

**Investigation:** `glob("app/api/webhooks/bundle*")` returned `bundlesocial/route.ts` AND `bundle-social/route.ts`. Both files exist.

**Resolution:** Unclear which is registered at bundle.social's webhook dashboard (this requires checking the external dashboard — a Hard Stop §2 if we needed to verify live). Classified as a MEDIUM gap / investigation item. Not blocking any feature.

---

## A7 — GIPHY env var classification

**Assumption:** ToolsRow.tsx uses `NEXT_PUBLIC_GIPHY_API_KEY`. Whether it's set in production was not verifiable from code inspection alone.

**Investigation:** Found the env var reference in `ToolsRow.tsx` line 157. Confirmed the code shows a graceful "not set" message when absent (not a runtime error). The brief's ENV.md listed `GIPHY_API_KEY` without the `NEXT_PUBLIC_` prefix, but the code correctly uses `NEXT_PUBLIC_GIPHY_API_KEY`. There is a mismatch in the brief's documentation vs implementation, but the implementation is correct.

**Resolution:** Classified as UNKNOWN for production status. Not verifiable without `vercel env ls`. Functional degradation (shows "not set" message) not a crash. Low priority to resolve.

---

## A8 — "Approval review page e2e" classification

**Assumption:** All critical customer flows should have e2e coverage per CLAUDE.md.

**Investigation:** Searched `e2e/` for specs mentioning `/review/`, `review-link`, `ReviewDecisionForm`, or approval token flows — none found. The `app/(public)/review/[token]/page.tsx` exists and is functional but untested at the e2e layer.

**Resolution:** Classified as a LOW priority gap. The review page is a critical path (external approver sees it), but it's a simple read-only + form-submit page with JWT verification. Core logic is tested at the unit layer via the JWT verification and state machine.

---

## Search methodology

All searches performed using Glob and Grep tools against `C:\Users\StevenMorey\dev\opollo-site-builder`.

Key search patterns used:
- `glob("supabase/migrations/01*.sql")` — schema inventory
- `glob("app/api/platform/social/**/*.ts")` — API route inventory
- `glob("app/api/cron/**/*.ts")` + `glob("app/api/internal/cron/**/*.ts")` — cron inventory
- `glob("components/social/composer/**/*.tsx")` — composer component inventory
- `glob("components/social/dashboard/**/*.tsx")` — dashboard component inventory
- `glob("components/admin/health/**/*.tsx")` — admin health component inventory
- `glob("e2e/**/*.spec.ts")` — e2e test inventory
- `grep "CalendarShell|SocialCalendarClient" app/` — dual calendar discovery
- `grep -rn "/social/poster"` across all production code — nav link gap discovery
- `grep "bundle*" app/api/webhooks/` — dual webhook discovery
- Reading `vercel.json` for cron schedule confirmation
- Reading `lib/platform/service-health/status.ts` for service count
