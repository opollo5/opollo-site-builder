# Session Complete — 2026-05-28

Multi-day autonomous session. Work started with the FIX-1–FIX-5 workstream and concluded with the V1→V2 cleanup sprint and production hardening.

---

## PRs Shipped This Session

**Total: 37 PRs merged to main + 2 open (CI running)**

### Composer v3 Gap Fixes (2026-05-21)
| PR | Title |
|----|-------|
| #985 | feat(calendar): unified MonthCalendar, content-type chips, edit-mode highlight |
| #987 | feat(composer): d3 edit-mode parity — click routing, header, failure banner, convert-to-draft |
| #988 | fix(calendar): composer v3.2 gap fixes — items 10, 17, 20 |
| #989 | fix(calendar): remove Redis cache from calendar-view — P0 posts not appearing |
| #990 | fix(auth): signout before callback exchange + hard-nav after login |
| #991 | fix(composer): month-calendar visual parity + close button absolute position |
| #992 | fix(ai-assist): better error categorization for Anthropic billing failures |
| #993 | fix(social/composer): edit-mode hydration, write-path, timezone, mid-session swap |
| #994 | fix(social/composer): chip click shows discard dialog when draft is dirty |
| #998 | fix(social/calendar): consolidate calendar grid, fix today pill + tint, AI assist dialog |

### UI + Auth Fixes (2026-05-22)
| PR | Title |
|----|-------|
| #999 | refactor(ui): button consistency migration — items 1-12 complete |
| #1001 | fix(auth): use redirect() in 2FA challenge path to avoid Incident 20.4 guard collision |
| #1002 | fix(button-migration): cleanup — gates enforce items 1, 8, 9 |
| #1003 | feat(admin): theming dashboard for per-company token overrides |

### CAP + Insights Module (2026-05-23 — 2026-05-24)
| PR | Title |
|----|-------|
| #997 | feat(cap): inject performance priors into campaign-post system prompt |
| #1004 | feat(insights): foundation schema, permissions, and cap_generation_runs operation extension (PR-01) |
| #1005 | feat(insights): feature-extract cron + source attribution + ingest observability (PR-02) |
| #1006 | refactor(charts): migrate Recharts to ECharts + shared wrappers + ESLint guardrail (PR-05) |
| #1007 | feat(insights): customer dashboard at /company/social/insights (PR-03) |
| PR-04 | feat(insights): admin multi-client dashboard at /admin/insights with audit fail-closed |
| PR-06–PR-08 | feat(insights): PRs 06–08 (recompute cron, generators, recommendations API) |
| PR-09–PR-11 | feat(insights): PRs 09–11 (generation priors, industry signals, pattern library) |
| #1014–#1021 | feat(insights): PRs 10–15 (competitor scrape, gap analysis, closeout) |

### Composer Edit-Mode / Minor Fixes (2026-05-24)
| PR | Title |
|----|-------|
| #1022 | fix(social/composer): mapV1ToV2Draft throws on V2 rows with empty draft_data |
| #1023 | fix(composer): ai assist modal — filled Generate button + remove duplicate close |
| #1024 | fix(composer): library tab reads from central image_library (1,777+ images) |
| #1029 | feat(insights): composer sidebar, Sheet evidence drawer, three-strike warning |

### FIX-1 through FIX-5 Workstream (2026-05-27)
| PR | Title |
|----|-------|
| #1033 | chore(ci): rename SUPABASE_DB_PASSWORD secret → STAGING_SUPABASE_DB_PASSWORD |
| #1067 | fix(auth): clear stale 2FA cookies when AUTH_2FA_ENABLED is off |
| #1068 | fix(middleware): exempt /styles/, /fonts/, extensions from auth gate |
| #1083 | fix(social): 422 when scheduling a post with no target channels |
| #1084 | fix(social): bulk csv upload requires schedule_post permission |
| #1086 | fix(social/publish-due): atomic claim via FOR UPDATE SKIP LOCKED |
| #1089 | feat(platform): opollo staff full access + audit log + cross-tenant invite block |
| #1090 | feat(users): hard delete on company removal (D1) |
| #1091 | fix(audit): log implicit staff admin grants via opollo_users auto-provision (DI-007) |
| #1092 | fix(approval): close ApprovalToggle permission gate gap (DI-010) |
| #1093 | fix(approval): external approvers can submit via magic-link token (D5) |
| #1095 | fix(social): platform inventory bug batch (DI-001/002/004/005/006/009) |
| #1097 | fix(security): rate-limit review-link and social-publish endpoints (INFRA-003/004) |
| #1098 | fix(security): move link-preview auth gate before url/ssrf validation (DI-006) |

### V1→V2 Social Model Migration (2026-05-27 — 2026-05-28)
| PR | Title |
|----|-------|
| #1096 | docs(migrations): v1-to-v2 social model consolidation plan and inventory |
| #1099 | fix(ci): use PRODUCTION_SUPABASE_DB_PASSWORD in deploy-migrations workflow |
| #1100 | feat(social): V1→V2 PR-01 — add source_type + link_url schema gaps to social_post_drafts |
| #1101 | feat(social): V1→V2 PR-02 — add bundle_post_id + source attribution to social_post_drafts |
| PR-03 | feat(social): v1-to-v2 PR-03 — calendar-view reads link_url from social_post_drafts |
| #1103 | feat(social): v1-to-v2 PR-04 — V1→V2 backfill script [WRITE-SAFETY-CRITICAL] |
| #1104 | feat(social): cap generator writes to social_post_drafts (v2 migration) |
| PR-06 | feat(social): bulk CSV writes to social_post_drafts |
| #1106 | feat(social): post create handler writes to social_post_drafts (v2 migration pr-07) |
| #1107 | feat(social): v2 dual-lookup dispatch for approval workflow routes (pr-08) |
| #1108 | feat(social): v2-first notification lookup in external approval route (pr-09) |
| #1109 | feat(social): add v2 social_post_drafts to viewer calendar page (pr-10) |
| #1110 | feat(social): v2 dual-lookup for scheduling lib (pr-11) |
| #1111 | chore(social): retire V1 publish backfill + watchdog crons (pr-12) |
| #1112 | feat(social): retire V1 QStash publish pipeline (pr-13) |
| #1113 | feat(social): v2 dual-lookup in BSP webhook post events (pr-14) |
| #1114 | feat(social): v2 dual-lookup in social analytics (pr-15) |
| #1115 | feat(social): migration 0157 — V1 social post soft-delete (pr-16) [WRITE-SAFETY-CRITICAL] |
| #1117 | ci(staging): add V1→V2 staging backfill workflow |
| #1123 | fix(middleware): exempt /api/internal/cron/* from auth gate |
| #1124 | chore(v1v2): migration complete doc + cleanup sprint phase 1 |
| #1125 | chore(v1-cleanup): remove V1 fallback from scheduling module (phase 2) |

### This Session (2026-05-28)
| PR | Title | Status |
|----|-------|--------|
| #1126 | chore(v1-cleanup): remove dead V1 watchdog + backfill publishing utilities (phase 4) | CI running |
| #1127 | fix(db-direct): reject Supabase direct-connection URLs + regression test + static audit | CI running |

---

## Final State

### Production
- All FIX-1–FIX-5 features deployed and verified (UAT 42/42 pass as of 2026-05-27)
- V1→V2 migration PRs 1–16 merged to main
- Migration 0157 (V1 soft-delete) merged to main; **production application status: pending Steven's deployment run**
- V1 tables still exist in production (7-day soak window per PLAN.md Phase 7)
- `SUPABASE_DB_URL` in Vercel production **must be updated to session pooler** — this is the HARD STOP that blocked cron delivery. See below.

### Staging
- All V1→V2 migration work deployed to staging
- Staging backfill workflow (PR #1117) runs on push to staging branch
- `STAGING_UAT_SECRET` + `VERCEL_BYPASS_SECRET` needed for UAT harness to run against staging

### Open PRs (CI running as of session end)
- **#1126** — Phase 4 dead V1 code removal (watchdog.ts, backfill.ts)
- **#1127** — db-direct runtime validation + regression test + static audit check17

---

## Outstanding Items

### CRITICAL: SUPABASE_DB_URL Hard Stop

**The most important unresolved item.** All direct-postgres crons (publish-due,
process-brief-runner, batch-worker, etc.) fail in production with:

```
getaddrinfo ENOTFOUND db.sazapxgmrdaewrkwoxby.supabase.co
```

Root cause: `SUPABASE_DB_URL` is set to the Supabase direct connection host
(`db.<ref>.supabase.co`) which is now IPv6-only. Vercel is IPv4-only.

**Fix required (Steven only — Vercel dashboard):**

1. Go to Vercel → Project → Settings → Environment Variables
2. Find `SUPABASE_DB_URL` in Production scope
3. Change it from: `postgresql://postgres:<pw>@db.sazapxgmrdaewrkwoxby.supabase.co:5432/postgres`
4. Change it to: `postgresql://postgres.sazapxgmrdaewrkwoxby:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres`
   - Find the pooler URL at: Supabase Dashboard → Project → Connect → Session Mode
   - The region is where the project is hosted (likely `ap-southeast-2` for Melbourne)

**PR #1127** adds runtime validation: `parseDbUrl()` now throws a descriptive error
if the direct-connection pattern is detected (rather than failing later with ENOTFOUND).

### Pending: PR #1116 (V1 Table Drop)

Branch `feat/v1-to-v2-pr17-v1-table-drop` — do NOT merge until:
1. Migration 0157 (V1 soft-delete) is applied to production
2. 7-day production soak period with zero errors on V2 pipeline
3. Steven manually merges (write-safety-critical)

Current status: 68+ active V1 TypeScript references exist in the V1 UI system
(posts CRUD, approval workflow, variants, viewer links). Per D3, V1→V2 full
migration is a **separate dedicated workstream** (Steven fires scoping prompt).
The V1 table drop PR should only merge when that workstream completes.

### Pending: Apply Migration 0157 to Production

Migration `0157_v1_soft_delete.sql` is merged to main but not yet applied to
production. Steven needs to run the migration deployment:

```bash
npx vercel env pull .env.production
# Then run the deploy-migrations workflow on GitHub Actions for production
```

### UAT Harness Secrets

Two secrets needed before UAT harness runs against staging automatically:
- `STAGING_UAT_SECRET` — in both Vercel staging env + GitHub Actions secrets
- `VERCEL_BYPASS_SECRET` — in GitHub Actions secrets (bypass protection pages)
- `STAGING_CRON_SECRET` — for the new `e2e/uat/cron-db-connectivity.spec.ts`

---

## Testing Coverage Added This Session

| Layer | Files Added |
|-------|------------|
| Regression (L1) | `tests/regressions/supabase-db-url-direct-connection.test.ts` — 5 tests pinning `parseDbUrl()` behaviour |
| Regression (L1) | `tests/regressions/bulk-csv-requires-schedule-permission.test.ts` (pre-existing, untracked) |
| UAT (L5) | `e2e/uat/cron-db-connectivity.spec.ts` — tests publish-due DB connectivity against staging |
| Static audit | `check17_dbDirectUrlPoolerValidation` in `scripts/audit.ts` — HIGH gate if db-direct.ts loses the validation |
| Integration (L3) | `lib/__tests__/social-calendar.test.ts` — rewrote for V2 seeding (6 tests) |

---

## Lessons Learned

### 1. SUPABASE_DB_URL: Direct Connection Is IPv6-Only

**How it slipped through:** The direct connection URL worked locally (IPv4+IPv6 dual-stack)
and in staging (which may have been on an older Vercel region or the fix wasn't tested end-to-end).
The issue was silently breaking all direct-postgres crons in production for an unknown
duration before it was detected.

**What should have caught it earlier:**
- A startup validation in `lib/db-direct.ts` (now added in PR #1127)
- A UAT spec that fires a cron and checks the response (now added)
- CI-time env var validation against the pooler URL pattern (hard to enforce without Vercel API access)

**Prevention:** PR #1127 adds three layers: runtime rejection in `parseDbUrl()`,
regression test, and static audit check17.

### 2. V1 Cleanup Sprint Scope Was Larger Than Estimated

The initial estimate was "a few PRs to remove dead V1 code." Actual scope was 17 PRs
for the migration proper + 4 more cleanup phases. The V1 UI system (posts/approval/variants)
is still active per D3 (separate workstream). Future sessions should scope V1→V2 UI
migration separately.

### 3. Integration Test Seeding Must Match the Active Pipeline

`social-calendar.test.ts` was seeding V1 posts via `createApprovedPost()` but
`listCompanyScheduleEntries()` had been migrated to V2-only. The mismatch caused
test failures until the seeding was updated to V2. Pattern: always seed tests through
the same pipeline the lib function reads from.

---

## Recommended Next Focus

**Primary:** Fix `SUPABASE_DB_URL` in Vercel production (CRITICAL — cron delivery broken).

**Secondary (Steven fires scoping prompt):**
- V1→V2 UI migration workstream (D3) — remove V1 posts/approval/variants UI
  and consolidate all social posting to the V2 Composer/Calendar flow.

**Tertiary:**
- Apply migration 0157 to production after confirming the V2 pipeline is handling
  all new posts correctly.
- Run `scripts/migrate-v1-to-v2.ts` backfill on production (copies V1 posts to V2).

---

*Session ended 2026-05-28. PRs #1126 + #1127 in CI at time of writing.*
