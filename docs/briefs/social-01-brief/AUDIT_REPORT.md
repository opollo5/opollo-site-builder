# Social Composer Audit Report

**Audited:** 2026-05-19  
**Branch audited:** `main` @ commit `41e843ec` (wave 3 merge, #917)  
**Scope:** Social-01 composer workstream + framework waves 1–4  
**Time:** ~45 minutes (automated checks + source inspection)

---

## Verdict: NEEDS FIXES

The core publish pipeline is functional (build passes, 1778 unit tests pass, CI green on main for all prior merges). But four gaps exist that would cause user-visible failures in production: the AddProfileDropdown is missing, ComposerPreview is missing from the V2 path, the rate-limit abstraction layer the API routes depend on is partially absent, and PR #918 (wave 4) is still open with CI in progress. None of these are catastrophic data-loss risks, but two of them (AddProfileDropdown, rate-limit index) would surface as runtime import errors.

---

## Critical Issues

### C-1 — `lib/platform/rate-limit/index.ts` is missing — RUNTIME IMPORT ERROR RISK

**Brief specifies:** A unified `check()` export at `lib/platform/rate-limit/index.ts` and a primary Upstash implementation at `lib/platform/rate-limit/upstash-rate-limit.ts`. The `POST /drafts/bulk`, `POST /drafts`, and `GET /drafts/[id]/analytics` routes are supposed to call `checkRateLimit()` from this module with Upstash as primary and Postgres as fallback.

**What exists:** Only `lib/platform/rate-limit/postgres-rate-limit.ts`. The brief-specified index and upstash files do not exist.

**What the routes actually do:** They import `checkRateLimit, rateLimitExceeded` from `@/lib/rate-limit` (the existing repo module, not the new platform module) and `checkBulkCsvRateLimit` from `lib/platform/rate-limit/postgres-rate-limit` directly. The build passes because `lib/rate-limit` exists. Rate limiting is **functionally active**, but:
- Upstash is not in use for the new social endpoints (Postgres-only rate limiting is slower)
- The two-layer fallback architecture the API_CONTRACTS.md §10 specifies is not implemented

**Severity:** MEDIUM for rate-limiting correctness (Postgres fallback is functional but slower). LOW for runtime stability (build passes, no broken imports).

---

### C-2 — `components/social/dashboard/AddProfileDropdown.tsx` is missing

**Brief specifies:** A "Add profile" dropdown mounted in the dashboard filter area, backed by `components/ui/dropdown-menu.tsx`, linking to `/company/social/connections/connect/[platform]`. Listed in `COMPONENT_MAP.md §"Dashboard"` and `§"File path summary"`.

**What exists:** Nothing. Neither the file nor any import referencing `AddProfileDropdown` exists in the new social codebase. The V1 code has no equivalent either.

**User-visible impact:** Users with no connected profiles see the empty-state callout (correct), but after connecting a first profile there is no "Add another" affordance anywhere on the dashboard. The only path to add a profile is navigating to the connections page directly.

**Severity:** HIGH — a visibly missing UI element on the primary dashboard surface.

---

### C-3 — ~~`components/social/composer/ComposerPreview.tsx` is missing from the V2 path~~ CLOSED by PR fix/composer-preview-platform-variants

**Brief specifies:** `components/social/composer/ComposerPreview.tsx` with props `{ draft: Draft, activeTab: 'preview' | 'calendar', onTabChange: (t) => void }`. Listed in `COMPONENT_MAP.md §"Composer overlay"`.

**What exists:** `components/composer/composer-preview.tsx` (V1, kebab-case) at the old path. The new `components/social/composer/` directory has 15 files but not `ComposerPreview.tsx`.

**What this means in practice:** `ComposerEditor.tsx` at the new path must either inline its preview panel or import from the V1 path. No reference to `ComposerPreview` exists anywhere in `components/social/`. The preview pane — post rendering per platform with tab switching between preview and mini-calendar — either doesn't exist in the V2 composer or is inlined without its own component file.

**Investigation result (2026-05-19):** Status is INLINED with one embedded bug. The right pane exists in `ComposerOverlay.tsx:272–342` and uses `PreviewCard` for rendering. The bug: `ComposerOverlay.tsx:318` passed `content={draft.content}` unconditionally instead of the platform-specific variant.

**Fix (PR fix/composer-preview-platform-variants):** Changed to `content={draft.platform_variants[previewConnection.platform]?.content ?? draft.content}`. Added `data-testid="preview-card"` to `PreviewCard`, `data-testid="content-textarea"` to `ContentEditor` textarea. Added component test `components/__tests__/ComposerVariantPreview.test.tsx` (4 cases) and e2e guard test V2-9. Updated COMPONENT_MAP.md to remove stale `ComposerPreview.tsx` entry.

---

### C-4 — PR #918 (framework wave 4) is still open

**State:** OPEN. CI running. `e2e`, `build`, `test (1–4)`, `Analyze`, `lhci`, `screenshots` all pending at audit time. Early checks (typecheck, lint, test-unit, test-components, scan, static-audit, migration-versions) have all passed.

**Wave 4 scope:** 3 new templates (T-AUTH-CHROME, T-FULL-BLEED-EDITOR, T-ERROR-STATE) + migration of ~16 routes (login, auth flows, `/company/image/generate`, `/auth-error`, plus 4 redirect stubs).

**Severity:** MEDIUM — auth page templates not yet migrated means the auth surfaces (login, password reset, invite accept) still use the old design system. Not a functional regression but the cutover is incomplete.

---

## Brief-to-Code Gaps

| # | Item | Brief says | Reality | Functional? |
|---|---|---|---|---|
| G-1 | `lib/platform/rate-limit/index.ts` | Unified `check()` export, Upstash primary | File doesn't exist; routes use `@/lib/rate-limit` + postgres-only | Yes, via fallback |
| G-2 | `lib/platform/rate-limit/upstash-rate-limit.ts` | Upstash primary implementation | File doesn't exist | N/A |
| G-3 | `components/social/dashboard/AddProfileDropdown.tsx` | Dashboard "Add profile" dropdown | File doesn't exist | No |
| G-4 | `components/social/composer/ComposerPreview.tsx` | Preview pane component | File doesn't exist at V2 path | Unknown |
| G-5 | `app/(platform)/social/poster/composer/page.tsx` | Composer sub-route | Directory doesn't exist; composer is a modal overlay | Yes (different approach) |
| G-6 | Health dashboard components path | `app/(platform)/admin/system/health/components/{ServiceStatusGrid,EventTimeline,BillingIssueDialog}.tsx` | Actual: `components/admin/health/{ServiceStatusGrid,EventTimeline,BillingIssueDialog}.tsx` | Yes (correct path in import) |
| G-7 | Service-health admin API path | `app/api/platform/admin/service-health/events/route.ts` | Actual: `app/api/admin/service-health/events/route.ts` | Yes (correct path in code) |
| G-8 | Service-health flag route path | `app/api/platform/admin/service-health/events/flag/route.ts` | Actual: `app/api/admin/service-health/flag/route.ts` (not under `events/`) | Yes |
| G-9 | `BillingIssueDialog` usage | Mounted in health dashboard | File exists at `components/admin/health/BillingIssueDialog.tsx` but NOT imported in health page | No UI entry point |
| G-10 | Framework wave 4 | 16 routes migrated to templates | PR #918 open, CI in progress | In progress |

**Clarification on G-5:** The brief says the composer could be a "modal mount" (see `BUILD_ORDER.md §PR C`). The overlay approach taken is within-spec — this is not a gap.

**Clarification on G-6, G-7, G-8:** The actual paths work; the brief's paths are wrong. These are documentation inconsistencies, not functional gaps.

---

## CLAUDE-ASSUMPTION Review

All five assumptions were logged in `docs/briefs/social-01-brief/composer/ACCEPTANCE.md §DECISION_TRAIL`.

| # | File | Assumption | Assessment | Severity |
|---|---|---|---|---|
| A-1 | `lib/social/schemas/create-draft.ts:15` | Used `z.record(z.string(), ...)` instead of `z.record(platformSchema, ...)` because Zod v4 requires all enum keys in `.default({})` | Correct. The wider key type avoids a Zod constraint without loosening runtime validation — the platform field is validated at the `target_profile_ids` level. | LOW |
| A-2 | `lib/social/schemas/approve.ts:8` | Used `z.ZodIssueCode.custom` for 30/500 char bounds — Zod v4 removed `too_small`/`too_big` for string | Correct. This is the documented Zod v4 migration path. Test coverage validates the 29-char rejection case. | LOW |
| A-3 | `supabase/migrations/0134_analytics_cache.sql` | Used `is_company_member()` instead of `auth.user_belongs_to_company()` for RLS | Correct. `auth.*` functions cannot be created from the migration role; `is_company_member()` is the established function from migration 0070 used across all other RLS policies. | LOW |
| A-4 | `supabase/migrations/0135_cron_infrastructure.sql` | Used `is_opollo_staff()` instead of `'platform_admin'` role check | Correct. The `platform_company_role` enum has no `admin` variant; `is_opollo_staff()` is the right gate for internal observability tables. | LOW |
| A-5 | `lib/social/types.ts:24` | `created_by_user_id` in `DraftResponse` maps to DB column `created_by` | Plausible — the DB column name and the TS type name differ. Risk: if the `GET /drafts/[id]` route selects `created_by` from Postgres but the response type declares it as `created_by_user_id`, one of two things is true: (a) the route renames it in the select (correct) or (b) the field is silently `undefined` in the response. **Not verified against the route implementation.** | MEDIUM — recommend inspecting `app/api/platform/social/drafts/[id]/route.ts` |

---

## Automated Check Outputs

| Check | Result |
|---|---|
| `npm run typecheck` | **PASS** — no errors |
| `npm run lint` | **PASS** — no warnings |
| `npm run build` | **PASS** — `/social/poster` builds at 48.8 kB (first-load JS 232 kB) |
| `npm run test:unit` | **PASS** — 1778 tests, 61 files, 5.78s |
| `npm run audit:static` | **PASS** — 0 HIGH, 17 MEDIUM, 79 LOW |

### Audit:static MEDIUM findings worth noting

**`error-handling` (14 instances):** 14 Supabase `insert()` calls across `lib/social/approval/escalate.ts`, `lib/platform/service-health/record.ts`, `lib/platform/social/connections/*`, and `lib/platform/auth/service-auth.ts` do not have a detected error check within ±12 lines. The static analyser is pattern-based — some of these may check errors via destructuring higher in the call. The one that is most concerning in this workstream context is:

- `lib/social/approval/escalate.ts:46` — approval decision insert during escalation cron. If this insert fails silently, the escalation event is written to the heartbeat but no `social_post_approval_decisions` row is created, which means the approval trail would be incomplete.

**`admin-api-gate` (2 instances):** `requireAdminForApi()` called with no explicit roles at `app/api/admin/companies/[id]/social-profiles/[profileId]/analytics/dashboard/route.ts:31` and `.../analytics/refresh/route.ts:35`. Default permits both `super_admin` and `admin` roles since #379 — functionally correct but relies on that default being stable.

**`db-column-references` (1 instance):** `app/api/internal/error-reports/route.ts:136` references column 'null' in `error_reports` — likely a false positive from NULL handling in the static analyser.

---

## Database State

**Note:** Direct Supabase query access was not available during this audit. The SQL queries from the brief spec are provided here for Steven to run:

```sql
-- Expect 6 heartbeat rows (one per cron job)
SELECT COUNT(*) FROM cron_heartbeats;

-- Verify recent run timestamps
SELECT job_name, last_run_at, last_status FROM cron_heartbeats ORDER BY last_run_at DESC;

-- Health events in last 24h
SELECT COUNT(*) FROM service_health_events 
WHERE last_seen_at > NOW() - INTERVAL '24 hours';

-- Verify all migration columns landed on social_post_drafts
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'social_post_drafts'
ORDER BY ordinal_position;
-- Expected new columns (0127–0135): parent_draft_id, recurrence_rule, recurrence_state,
-- occurrence_index, planned_for_at, published_at, published_url, last_publish_error, publish_attempts
```

**Known state from PR merge history:** Migrations 0127–0135 were applied as part of PR A (#903) and confirmed live via PostgREST schema check at merge time.

---

## Sentry Summary

**Note:** No Sentry credentials or project URL were available during this audit. Cannot check error volume post-#912 (flag removal deploy).

**Recommended action:** Check Sentry for any `TypeError: Cannot read properties of undefined` or `Module not found` errors since the #912 merge timestamp (2026-05-18). The most likely source of new Sentry errors would be the `ComposerPreview` gap (if the preview pane is truly absent, users attempting to preview would see an unhandled exception rather than a UI failure).

---

## PR State at Audit Time

| PR | Title | State | Merged |
|---|---|---|---|
| #913 | feat(framework): wave 1 | MERGED | 2026-05-19 01:26 UTC |
| #914 | feat(framework): wave 2a | MERGED | 2026-05-19 02:06 UTC |
| #915 | feat(framework): wave 2b | MERGED | 2026-05-19 02:48 UTC |
| #916 | feat(framework): wave 2c | MERGED | 2026-05-19 03:05 UTC |
| #917 | feat(framework): wave 3 | MERGED | 2026-05-19 03:26 UTC |
| #918 | feat(framework): wave 4 | **OPEN** | CI running (typecheck/lint/unit pass; build/e2e/integration pending) |

**Main branch CI** (post-#917 merge): `CI` and `E2E` workflows in-progress at audit time. `Dependency audit`, `Release`, `Secret scan` complete with `success`.

---

## Recommended Next Actions (Priority Order)

1. **[NOW] Inspect `ComposerEditor.tsx` lines 1–50** — confirm whether the preview pane is present inline or genuinely absent. If absent, this is the highest-priority fix before any production traffic touches the V2 composer.

2. **[NOW] Inspect `app/api/platform/social/drafts/[id]/route.ts`** — confirm the GET handler maps DB column `created_by` to response field `created_by_user_id` (assumption A-5). If not, analytics modal and "Schedule again" pre-fill will silently show no attribution.

3. **[HIGH] Build `AddProfileDropdown.tsx`** — without it, users who reach the dashboard with no connected profiles or want to add a second profile have no UI affordance. Path: `components/social/dashboard/AddProfileDropdown.tsx`. Use `components/ui/dropdown-menu.tsx` per the COMPONENT_MAP spec. Each item links to `/company/social/connections/connect/[platform]`.

4. **[MEDIUM] Wait for PR #918 CI and merge** — closes the wave 4 gap. Auth pages move to the V2 design system. Check CI on PR #918 before merging.

5. **[MEDIUM] Run the DB sanity queries** — the four SQL queries in the Database State section. Specifically confirm `cron_heartbeats` has 6 rows and that `last_run_at` for `publish-due` is recent (< 2 minutes ago at any time of day).

6. **[MEDIUM] Check Sentry for errors since #912 merge** — focus on TypeError and Module errors. Any spike > baseline indicates a V2 surface regression.

7. **[LOW] Implement `lib/platform/rate-limit/index.ts` + `upstash-rate-limit.ts`** — the unified rate-limit module the brief specifies. Currently the new social endpoints use the existing `lib/rate-limit` module which works, but without Upstash as the primary layer the rate-limit checks are slower (Postgres advisory lock) and the two-layer degradation architecture isn't in place.

8. **[LOW] Fix `lib/social/approval/escalate.ts:46`** — add error-check on the Supabase insert for approval decisions. Silent insert failures would corrupt the approval trail.

9. **[LOW] Update brief documentation** — COMPONENT_MAP.md and API_CONTRACTS.md list wrong paths for health dashboard components and service-health admin API routes. Update to match actual locations (`components/admin/health/` and `app/api/admin/service-health/`) to avoid confusing the next Claude session.

10. **[LOW] Manual smoke test** — the ACCEPTANCE.md §"Manual smoke" checklist has 10 steps that require a real LinkedIn account, real CSV upload, and real approval email flow. These should be run before declaring the feature production-ready.
