# Hardening Pass — Final Report

Generated: 2026-05-20

## Workstream summary

| WS | Description | PRs | Status |
|---|---|---|---|
| WS1 | CAP backlog — objective template, health events, cron skip | #939 | ✅ merged |
| WS2 | Wireframe audit + HIGH gap fixes | #940, #941 | ✅ merged |
| WS3 | Smoke test harness + composer + CAP probes | #942, #943, #944 | ✅ #942 #943 merged; #944 (CAP smoke) CI pending |
| WS4 | Cost monitoring daily report | #945 | ✅ merged |
| WS5 | Staging environment scaffold + guards | #946 | ✅ merged |
| WS6 | README + ARCHITECTURE + RUNBOOK | #947 | ✅ merged |

## What shipped (merged to main)

### WS1 — CAP objective template (#939)

- Migration `0139`: `monthly_objective_template TEXT` column on `cap_subscriptions`
- `PATCH /api/platform/cap/subscriptions/{id}` endpoint to save template
- `CapSubscriptionPanel` UI: textarea form + amber warning callout when template unset
- `lib/cap/monthly-generation.ts`: cron skips subscriptions with null template, records `missing_objective_template` health event
- 5 unit tests in `lib/__tests__/cap-monthly-generation.unit.test.ts`

### WS2 — Wireframe audit + fixes (#940, #941)

- `docs/audits/WIREFRAME_AUDIT_2026-05-19.md`: 12-wireframe audit, 117+ MATCH findings, 2 HIGH gaps fixed
- **Wireframe 08 fix**: `UnsavedChangesDialog` — added optional `onSave` prop, "Save as draft" button, async save state
- **Wireframe 11 fix**: `AddProfileDropdown` — added TikTok with "New" badge, `isNew` prop
- 5 + 3 component tests updated/added

## What's in CI (pending merge)

### WS3 — Smoke harness (#942, #943, #944, stacked)

**#942** (base: main): `scripts/smoke/` scaffold
- `client.ts`: typed fetch wrapper (`smokeGet`, `smokePost`, `smokePatch`, `smokeDelete`)
- `assertions.ts`: `assertStatus`, `assertShape`, `assertTruthy`
- `budget.ts`: $5 cumulative cap with `budget.json` persistence
- `test-data.ts`: env var helpers
- 9 unit tests for budget guard
- npm scripts: `smoke:harness`, `smoke:composer`, `smoke:cap`

**#943** (stacked on #942 → main after merge): `scripts/smoke/composer.smoke.ts`
- 3-step: POST draft (201) → GET draft (200) → DELETE draft (204)
- Output: `scripts/smoke/output/composer-smoke-{timestamp}.json`

**#944** (stacked on #943 → main after merge): `scripts/smoke/cap.smoke.ts`
- Step 1: GET subscription check
- Step 2: Budget guard ($0.50)
- Step 3: POST generate → assert `postsGenerated=4`
- Step 4: Record spend
- `SMOKE_CAP_SKIP_GENERATION=1` for CI-safe runs

### WS4 — Cost monitoring (#945)

- `lib/platform/cost-monitoring/queries.ts`: `capCostSummary`, `tenantBudgetSummary`, `buildCostReport`
- `lib/platform/cost-monitoring/report.ts`: `sendDailyCostReport` — HTML/text email with threshold flags
- `app/api/cron/cost-monitoring-daily-report/route.ts`: `0 7 * * *` cron
- 16 unit tests (9 queries + 7 report)

### WS5 — Staging (#946)

- `lib/runtime-env.ts`: typed env detection (`APP_ENV` → `VERCEL_ENV` → `"development"`)
- `lib/email/sendgrid.ts`: staging email redirect to `STAGING_EMAIL_RECIPIENT`
- `lib/platform/cron/cron-shared.ts`: `guardedCronSkip` helper
- `app/api/cron/cap-monthly-generation/route.ts`: wired with `guardedCronSkip`
- 21 unit tests
- `docs/briefs/hardening-pass/STEVEN_ACTIONS.md`: staging setup instructions

### WS6 — Documentation (#947)

- `README.md`: product table, all test commands, smoke quick-start, staging pointer
- `docs/architecture/ARCHITECTURE.md`: §16b (Social Composer, CAP, Cost Monitoring, runtime-env), quick-reference updates
- `docs/runbooks/RUNBOOK.md`: 4 new entries (CAP generation down, cost spike, composer draft fail, cost report fail)
- `scripts/smoke/README.md`: env var reference + usage guide

## New unit test files added

| File | Tests | WS |
|---|---|---|
| `lib/__tests__/cap-monthly-generation.unit.test.ts` | 5 | WS1 |
| `components/__tests__/UnsavedChangesDialog.test.tsx` | 5 | WS2 |
| `components/__tests__/AddProfileDropdown.test.tsx` | updated | WS2 |
| `lib/__tests__/smoke-budget.unit.test.ts` | 9 | WS3 |
| `lib/__tests__/cost-monitoring-queries.unit.test.ts` | 9 | WS4 |
| `lib/__tests__/cost-monitoring-report.unit.test.ts` | 7 | WS4 |
| `lib/__tests__/runtime-env.unit.test.ts` | 15 | WS5 |
| `lib/__tests__/staging-cron-guard.unit.test.ts` | 3 | WS5 |
| `lib/__tests__/sendgrid-staging.unit.test.ts` | 3 | WS5 |

**Total new tests: ~56**

## Steven actions required

See `docs/briefs/hardening-pass/STEVEN_ACTIONS.md`:

1. **Staging Vercel env vars** — `staging` branch created 2026-05-20 ✅; add `APP_ENV=staging` and `STAGING_EMAIL_RECIPIENT` for the `staging` branch in Vercel dashboard (WS5)

**Resolved**:
- ~~**IDEOGRAM_API_KEY production scope**~~ — confirmed Production-scoped in Vercel as of 2026-05-20 ✅

## Deferred gaps (from wireframe audit)

See `docs/audits/WIREFRAME_AUDIT_2026-05-19.md` for full list. Non-blocking:
- Wireframe 05: schedule picker timezone indicator (LOW)
- Wireframe 09: approval required toggle in modal (LOW)
- Wireframe 12: analytics tab empty state illustration (DEFERRED — needs asset)
