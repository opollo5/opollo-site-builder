# Test Coverage Audit (M15-6)

**Date:** 2026-04-24
**Scope:** M1 → M14 — which code paths have tests, which don't, which are weak.
**Method:** Sonnet sub-agent enumerated every route + lib + E2E spec, cross-referenced against test files, and flagged weak patterns (mock-only assertions, skipped tests, `.only` CI blockers). Opus reviewed severity.
**Prior audits:** M15-2 (schema), M15-3 (env), M15-4 (endpoints), M15-5 (cross-cutting). This is the last audit in the series. After this, M15-7 consolidated fix pass begins.

---

## 🚨 TL;DR — one finding crosses the "write-safety-critical without tests" line

**`lib/encryption.ts` has zero tests.** The AES-256-GCM module that encrypts every site's WordPress application password has no unit tests — no encrypt→decrypt round-trip, no auth-tag tamper detection, no invalid-key handling, no `key_version` mismatch behaviour. Any refactor that silently breaks this module would corrupt every site's credentials with no test-suite signal. Combined with the broken rotation runbook from M15-3 finding #1 (code is single-key, runbook assumes dual-key), `sites.wp_app_password` integrity has zero test coverage AND a runbook that can't execute cleanly.

**Write-safety-critical per CLAUDE.md conventions.** This is the finding of the series that most closely matches the shape of the original M14-1 incident — high-stakes module that no automated signal would catch breaking.

Everything else is LATENT-RISK or TECH-DEBT:

- **14 of 45 API routes have zero dedicated handler tests** (31%). Includes `app/api/chat/route.ts` (the product's headline feature, only E2E-mocked), all 7 `tools/*` routes, 4 `cron/*` routes at the handler layer, `ops/self-probe`, and 3 admin routes.
- **16 of 58 lib modules have zero tests** (28%). Includes `encryption`, `wordpress` (WP REST client), the 7 tool lib implementations (`create-page`, `update-page`, `delete-page`, `get-page`, `list-pages`, `publish-page`), plus `redis`, `utils`, `http`, `html-size`, `leadsource-fonts`, `content-schemas`, `current-user`, `design-system-errors`.
- **1 E2E test is `fixme`'d** (`e2e/briefs-review.spec.ts` — the upload → parse → commit happy path is deferred pending save-draft persistence).
- **0 E2E tests skipped**, **0 `.only` CI blockers** — good baseline.

**Escalation triggers:**
- [x] **Production-breaking class finding** — `lib/encryption.ts` without tests is write-safety-critical per CLAUDE.md; "production-breaking on any future change" counts per my read of your escalation rule.
- [x] More than 10 findings — ~30 items (14 untested routes + 16 untested libs + several weak-test patterns).
- [ ] Need external data — no.

**I am NOT starting M15-7 until you respond.**

---

## Aggregate stats

| Metric | Count |
|---|---|
| Unit test files (`lib/__tests__/*.test.ts`) | 78 |
| Unit test invocations (`it(...)` / `test(...)`) | ~966 |
| E2E spec files | 10 |
| E2E tests total | 71 |
| E2E tests skipped | **0** |
| E2E tests `fixme` | **1** (briefs-review upload→parse→commit) |
| E2E `.only` (CI blockers) | **0** |
| Routes with **zero** handler tests | **14 of 45** (31%) |
| Routes with partial handler coverage | 8 of 45 (18%) — mostly mock-based or single-branch |
| Lib modules with **zero** tests | **16 of 58** (28%) |

Baseline is healthier than the 28-31% raw gap numbers suggest: many untested libs are utility modules (`utils`, `http`, `leadsource-fonts`, `html-size`) where a test-per-file is overkill. The real concerns cluster in specific high-stakes modules.

---

## Findings summary

| # | Severity | Category | Gap | Fix estimate |
|---|---|---|---|---|
| 1 | **PROD-BREAKING on change** | Lib | `lib/encryption.ts` — AES-256-GCM encrypt/decrypt, zero tests | ~1/2 day: round-trip + tamper + invalid-key + key_version tests |
| 2 | LIKELY-PROD-BREAKING | Route | `app/api/chat/route.ts` — no unit test; E2E uses `page.route` mock so server handler never runs | ~1 day: handler integration test with mocked Anthropic SDK |
| 3 | LIKELY-PROD-BREAKING | Routes (×7) | All `app/api/tools/*` routes have no tests — concerning given M15-4 flagged auth gaps on these same routes | ~1/2 day: body-parse + auth + delegation test per route (can share fixtures) |
| 4 | LIKELY-PROD-BREAKING | Lib | `lib/wordpress.ts` — WP REST client, zero dedicated tests; exercised only transitively via worker tests with mocked creds | ~1/2 day: unit tests for each `wpXxx()` call with mocked fetch |
| 5 | LATENT-RISK | Route | `app/api/cron/process-batch/route.ts` — no handler test (worker internals well-covered but HTTP entry point isn't) | ~2 hours: auth gate + dispatch + error envelope |
| 6 | LATENT-RISK | Route | `app/api/cron/process-transfer/route.ts` — no handler test. Overlaps with M15-5 finding #1 (not scheduled); if route is dead, delete it; if live, test it. | ~2 hours, or zero if deleted |
| 7 | LATENT-RISK | Route | `app/api/cron/budget-reset/route.ts` — lib covered, handler not | ~1 hour |
| 8 | LATENT-RISK | Route | `app/api/cron/process-regenerations/route.ts` — only WP_CREDS_MISSING branch tested | ~2 hours: happy path + retry branch |
| 9 | LATENT-RISK | Route | `app/api/ops/self-probe/route.ts` — no test | ~2 hours |
| 10 | LATENT-RISK | Route | `app/api/sites/[id]/route.ts` (PATCH/DELETE site metadata) — no test | ~2 hours |
| 11 | LATENT-RISK | Route | `app/api/admin/images/[id]/route.ts` (PATCH edit) + `/restore` — no test | ~2 hours each |
| 12 | LATENT-RISK | Route | `app/api/admin/sites/[id]/pages/[pageId]/route.ts` (PATCH edit metadata) — no test | ~2 hours |
| 13 | LATENT-RISK | Lib | `lib/tool-schemas.ts` — 6 of 7 JSON schemas untested | ~1 hour |
| 14 | LATENT-RISK | Lib (×7) | Tool lib implementations (`create-page`, `update-page`, `delete-page`, `get-page`, `list-pages`, `publish-page`, `search-images` route layer) — `search-images` lib is tested; the rest aren't | 2-3 hours each — larger because each wraps WP + supabase calls |
| 15 | LATENT-RISK | E2E | `e2e/briefs-review.spec.ts` upload → parse → commit happy path is `test.fixme` | Depends on M12 save-draft work shipping first |
| 16 | LATENT-RISK | Weak test | `e2e/chat.spec.ts` uses `page.route` mock — never exercises server handler | Addressed by finding #2 (add unit test) |
| 17 | LATENT-RISK | Weak test | `lib/__tests__/health-route.test.ts` — only happy path; degraded branches untested | ~1 hour |
| 18 | TECH-DEBT | Lib | `lib/current-user.ts` — no test | ~1 hour |
| 19 | TECH-DEBT | Lib | `lib/redis.ts` — no test (used transitively by `rate-limit.ts` which IS tested) | Low priority |
| 20 | TECH-DEBT | Lib | `lib/http.ts` — no test for `readJsonBody`, `parseBodyWith`, `respond`, `validationError`, `validateUuidParam` | ~2 hours |
| 21 | TECH-DEBT | Lib | Utility modules without tests (`utils`, `html-size`, `leadsource-fonts`, `content-schemas`, `design-system-errors`) | Usually fine; add if they grow |

---

## The critical finding — `lib/encryption.ts` without tests

### What the module does

`lib/encryption.ts` uses AES-256-GCM (per the schema and the `loadMasterKey()` 32-byte assertion) to encrypt the WP application password stored as `site_credentials.site_secret_encrypted bytea`. Every site write (`lib/sites.ts#createSite`) and every site read that needs to publish (`lib/sites.ts#getSite({ includeCredentials: true })`) calls this module. A silent correctness regression would break every site's ability to publish.

### What the test gap looks like

Searching `lib/__tests__/` for `encryption` or `loadMasterKey`: **no matches**. The module is only exercised indirectly — `lib/sites.ts` tests presumably round-trip through it, but there is no dedicated unit test pinning:

- Encrypt→decrypt round-trip with a known key and a known plaintext
- Tamper detection: modified ciphertext should fail auth-tag verification, not return garbage
- Invalid-key handling: wrong length, wrong base64, missing env — each should throw the documented error
- `key_version` behaviour: what happens when the column has a value the code doesn't expect

### Why this is the worst finding of the series

The M14-1 trigger was a production bug that shipped past lint + typecheck + unit + E2E + review. The shape: high-stakes module, unreviewed assumption, no test signal. `lib/encryption.ts` is structurally the same shape today — higher-stakes than the `deleted_at` bug (this is credential correctness), no dedicated test signal at all. It's an incident-in-waiting.

Combined with **M15-3 finding #1** (the rotation runbook assumes dual-key logic the code doesn't have), the encryption module has both an unverified implementation AND a playbook that can't execute as written.

### Recommended fix for M15-7

Ship a **urgent PR** with:

1. `lib/__tests__/encryption.test.ts`:
   - Round-trip: encrypt known plaintext with a seeded key, decrypt, assert equality
   - Tamper: modify one byte of ciphertext or IV, decrypt must throw (not return garbage)
   - Invalid key: no env → throw "OPOLLO_MASTER_KEY is not set"
   - Wrong key length: 31-byte and 33-byte keys → throw with clear message
   - `key_version` mismatch: if the code has version-aware decryption (it does not today per M15-3 finding #1), test that; if not, at least document the gap in the test
2. Defensive tests for `lib/sites.ts#createSite` + `getSite({ includeCredentials: true })` that assert observable DB state (ciphertext bytes present, non-zero, not equal to plaintext) rather than relying on mocks

I'd put this ahead of even the chat-route tests (finding #2). Severity is higher because the failure mode is silent and systemic — the chat route failing is loud.

---

## Other high-severity findings

### #2 — Chat route has no unit test

`app/api/chat/route.ts` is M1b + M5 — the product's headline feature. Tests today:

- `e2e/chat.spec.ts` uses `page.route("**/api/chat", ...)` to intercept and replace the HTTP response with canned SSE. The server handler never runs.
- `lib/__tests__/chat-errors.test.ts` (the one I shipped in PR #130) tests the sanitization helper, not the handler that uses it.

What's missing: an integration test that imports `POST` from `app/api/chat/route.ts`, mocks the Anthropic SDK + Supabase + WP creds, and exercises:
- Rate-limit gate (happy + denied)
- Tool dispatch (matches tool name → executor)
- Anthropic error classification (429 → safe SSE payload; 500 → same)
- SSE protocol correctness (multiple events, done event, error event placement)

This is achievable — `lib/__tests__/emergency-route.test.ts` is a good template for an HTTP-handler-level test with mocked deps.

### #3 — All 7 `tools/*` routes have no tests

`tools/create_page`, `tools/delete_page`, `tools/get_page`, `tools/list_pages`, `tools/publish_page`, `tools/search_images`, `tools/update_page`. The lib-level `search-images` is tested but the route wrapper is not; the other 6 libs have no tests either (finding #14).

M15-4 flagged these routes for missing auth guards on write operations (publish_page, update_page, delete_page). Adding tests now would pin the current behaviour as you fix those auth gaps — preventing a regression during the fix.

### #4 — `lib/wordpress.ts` has no dedicated tests

The WP REST client. Every `wpCreatePage`, `wpUpdatePage`, `wpPublishPage`, `wpGetBySlug`, `wpMediaUpload` call flows through this module. It's exercised transitively via the batch/regen worker tests (which supply mocked creds), but no dedicated unit test imports `wordpress.ts` and exercises each function with a mocked fetch.

Failure modes that have no test signal: WP returning 401 (credentials rotated), 500 (WP overloaded), malformed JSON response, missing `Location` header on POST response, `slug` collision handling.

---

## Weak-test patterns

Beyond the raw coverage gaps, the scanner flagged eight patterns where tests exist but don't actually prove behaviour:

- **`e2e/chat.spec.ts`** — `page.route` mock means server handler never runs. Addressed by finding #2.
- **`lib/__tests__/health-route.test.ts`** — only happy path. A misconfigured Supabase would not be caught. Covered in finding #17.
- **`lib/__tests__/sites-list.test.ts`** — calls the lib function, not the route handler. Auth gate + envelope untested.
- **`lib/__tests__/m8-budget-admin-ui.test.ts`** — same pattern; lib tested, route handler not.
- **`lib/__tests__/batch-create.test.ts`** — same pattern.
- **`lib/__tests__/anthropic-caption.test.ts`** — asserts on mocked return. Doesn't test what happens when the real model returns malformed JSON (there's branch coverage in the lib itself, but at the mock-contract layer only).
- **`lib/__tests__/reset-password-route.test.ts` + `forgot-password-route.test.ts`** — fully mocked Supabase. Passes even if the real integration is broken.
- **`lib/__tests__/cron-process-regenerations-wp-creds.test.ts`** — single branch (WP_CREDS_MISSING) tested; happy path and retry branches uncovered.

None of these are "remove the test" — they're "add a complementary test at the right layer." The pattern is: unit test at the lib layer with mocks, integration test at the route layer with real Supabase (or closer-to-real mocks), E2E at the browser layer.

---

## Critical-path coverage summary

From the full list in the sub-agent's output:

| Path | Dedicated tests | Error branches covered? |
|---|---|---|
| Auth: login / logout / password reset / invite / revoke / reinstate / role change | ✅ All have dedicated unit tests + E2E | ✅ Full matrix |
| **Chat streaming + tool execution** | ⚠️ E2E mock only | ❌ Server-side handler never runs |
| Batch generation end-to-end | ✅ 6 test files covering worker internals | ⚠️ Cron HTTP handler untested |
| Single-page regeneration | ✅ 5 test files covering worker internals | ⚠️ Cron HTTP handler only WP_CREDS branch |
| Image library + Cloudflare + WP transfer | ✅ Strong at lib + worker layer | ⚠️ `admin/images/[id]` route untested |
| Tenant budget enforcement | ✅ 4 test files + E2E | ⚠️ Budget-reset cron HTTP handler untested |
| Briefs upload + parse + commit | ✅ Route tests + parser tests + schema + RLS + E2E | ⚠️ E2E happy path is `test.fixme` |
| Design system activate / archive | ✅ Route + lib tests | ✅ Happy + one error per verb |
| Emergency route + kill switch | ✅ Full matrix | ✅ 503, 401, 400, idempotent on/off |
| **Self-probe (M10)** | ❌ No tests | ❌ None |
| **Credential encryption (M1/M2)** | ❌ **No tests** | ❌ **None** |

---

## What I did NOT cover in this audit

- **Mutation testing.** Raw coverage says "does this line ever run in a test?" It does not say "would a test fail if the line's behaviour were changed?" Mutation testing (Stryker, etc.) would answer that; out of scope here.
- **Code-coverage percentages.** The repo has `npm run test:coverage` with a 60% line / 55% branch baseline per `package.json`. I didn't run it for this audit — a file-level presence/absence scan was more actionable.
- **Test speed / flakiness history.** A test that's "tested" but takes 4 minutes, or flakes 1-in-20, is effectively under-tested for iteration speed. Would need CI history; out of scope.
- **Test-fixture freshness.** Some tests may seed fixtures that drift from production data shapes over time. No easy static signal.
- **Determinism review.** Whether tests rely on `Date.now()`, random IDs, or real network. E2E specs clearly do some of this; no systematic audit.

---

## Files produced

- `docs/TEST_COVERAGE_AUDIT_2026-04-24.md` (this file)
- No scratch file this round — Sonnet output fit inline.

All M15 audit reports are now on disk:
- `docs/SCHEMA_AUDIT_2026-04-24.md` (M15-2)
- `docs/ENV_AUDIT_2026-04-24.md` (M15-3)
- `docs/ENDPOINT_AUDIT_2026-04-24.md` (M15-4)
- `docs/PRODUCTION_RISK_AUDIT_2026-04-24.md` (M15-5)
- `docs/TEST_COVERAGE_AUDIT_2026-04-24.md` (M15-6 — this file)

Scratch inputs at `docs/_audit_scratch/` (canonical_schema, code_queries, code_endpoints) can be cleaned up in an M15-7 follow-up PR.

---

## All five audits complete — awaiting M15-7 triage

This is the last audit in the series. No further audits planned.

**Total M15 findings across all audits:**
- M15-2 (schema): 14 findings
- M15-3 (env): 14 findings → 3 fixed in PR #127
- M15-4 (endpoints): 19 findings → 2 fixed in PR #130
- M15-5 (cross-cutting risk): 27 findings (none urgent after verification)
- M15-6 (test coverage): ~30 findings (1 write-safety-critical)

**~100 findings total across the series. 5 fixed in two urgent PRs (#127, #130). ~95 items for M15-7 triage.**

The parallel session has also shipped M15-2-adjacent fixes independently (PR #128 dead schema drop, PR #129 schema defense-in-depth). Your triage needs to reconcile my findings with their work to avoid duplicates.

Recommended M15-7 triage approach:
1. **Urgent (ship as targeted PR this week):** `lib/encryption.ts` tests + decision on dual-key rotation (M15-3 #1 resurfaces here). This closes the highest-risk item.
2. **High-value batch (one defense-in-depth PR):** the 4 `console.error` bypasses (M15-5) + 5 routes with `err.message` leaks (M15-4) + missing version_lock CAS on briefs (M15-5). All touch the same observability + write-safety contract.
3. **Test-coverage batch (one PR per critical path):** chat route test, tools routes tests, wordpress.ts test. Each unblocks later defense-in-depth work.
4. **Latent-risk + tech-debt to BACKLOG:** everything else, with pickup triggers.

Not starting M15-7 until you respond with the triage signal.
