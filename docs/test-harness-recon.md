# Test Harness Reconnaissance — 2026-05-09

Concrete answers to the pre-build survey. Every claim is from a file or command
output captured on this date; line citations are anchors, not guarantees —
re-verify before acting on anything older than ~one milestone.

---

## 1. Existing test infrastructure

### 1a. Vitest setup

**Two configs exist — split by Supabase dependency:**

| Config | npm script | Include glob | Environment | Supabase? |
|---|---|---|---|---|
| `vitest.config.ts` | `npm test` | `lib/__tests__/**/*.test.ts` | Node (fork pool) | **Yes** — real local stack |
| `vitest.components.config.ts` | `npm run test:components` | `components/__tests__/**/*.test.{ts,tsx}` | jsdom | **No** |

**`vitest.config.ts` key settings:**

- `globalSetup: ["./lib/__tests__/_globalSetup.ts"]` — boots `supabase start` if the stack is not already running. Reads credentials via `_supabase-status.ts`, which has defensive JSON / plain-text fallback parsing for CLI version drift. Comment: *"may take 15–30s"* for cold start.
- `setupFiles: ["./lib/__tests__/_setup.ts"]` — `beforeEach` runs `truncateAll()` (TRUNCATE across all 35+ public-schema tables via a direct `pg` connection on port 54322); `afterAll` sweeps tracked auth users and closes the PG client.
- `fileParallelism: false` — files run serially, one shared Supabase stack. Explicit design decision to avoid cross-file TRUNCATE races.
- `testTimeout: 15_000` / `hookTimeout: 60_000`.
- Coverage: V8 provider, 60% lines / 55% branches / 55% functions / 60% statements (soft thresholds). Instruments `lib/**/*.ts` and `app/**/*.ts`, excludes `lib/__tests__/**` and thin client boilerplate.

**`vitest.components.config.ts` key settings:**

- jsdom environment, no globalSetup, no fileParallelism constraint (stateless).
- `globals: true`.
- Module aliases: `@/` → repo root, `server-only` → local stub (same as server config), plus stubs for `next/navigation`, `next/font/google`, `pdf-parse`, `mammoth`.
- Setup: `components/__tests__/_setup.ts` — imports `@testing-library/jest-dom/vitest` only.

**The integration ↔ unit split** is not by directory but by test style. Both live in `lib/__tests__/`. Integration tests call `getServiceRoleClient()` and hit the real DB. Unit tests mock their deps with `vi.mock()` and run against the node worker without making DB calls. There is no separate directory or config distinguishing them — a unit test is simply one that happens to mock everything.

---

### 1b. Existing tests

**Counts:**
- `lib/__tests__/`: **231 test files**
- `components/__tests__/`: **4 test files**
- `e2e/`: **32 spec files**

#### `lib/__tests__/` (231 files) — Integration + unit

This is the primary test suite. Files split loosely into:

| Group | Representative files | Style | Maturity |
|---|---|---|---|
| **Auth** | `auth.test.ts`, `auth-callback.test.ts`, `m2a-auth-link.test.ts`, `m2b-rls.test.ts`, `platform-auth.test.ts`, `password-policy.test.ts`, `middleware.test.ts` | Integration (real Supabase), some unit (mocked) | High — auth is the most exercised area |
| **Schema / RLS** | `m3-schema.test.ts`, `m4-schema.test.ts`, `m7-schema.test.ts`, `m8-*.test.ts`, `m12-1-rls.test.ts`, `m12-1-schema.test.ts` through `m13-5a-schema.test.ts`, `m16-schema.test.ts`, `p1-platform-schema.test.ts`, `migration-0110-*.test.ts`, `migration-0111-*.test.ts`, `zod-schema-db-sync.test.ts` | Integration (DDL + RLS gate tests) | High — every milestone ships schema tests |
| **Brief / batch generation** | `brief-runner.test.ts`, `brief-runner-anchor.test.ts`, `brief-runner-concurrency.test.ts`, `brief-runner-fragment-gate.test.ts`, `brief-runner-structural-gate.test.ts`, `brief-runner-visual.test.ts`, `brief-runner-mode.test.ts`, `brief-runner-extract-html.test.ts`, `batch-worker.test.ts`, `batch-worker-anthropic.test.ts`, `batch-worker-gates.test.ts`, `batch-worker-publish.test.ts`, `batch-worker-retry.test.ts`, `batch-create.test.ts`, `batch-cancel.test.ts` | Integration + concurrency harness | High — M3's write-safety requirements drove deep coverage |
| **Social platform** | `social-connections.test.ts`, `social-connections-bundlesocial.test.ts`, `social-posts.test.ts`, `social-post-transitions.test.ts`, `social-scheduling.test.ts`, `social-approval-*.test.ts`, `social-publishing-*.test.ts`, `social-webhooks-bundlesocial.test.ts`, `social-bulk-csv.test.ts`, `social-calendar.test.ts`, `social-variants.test.ts`, `social-notifications-wiring.test.ts`, etc. | Integration (real Supabase) | Medium-high — spec22 composer area had 6+ hotfix PRs in last 30 days |
| **M16 site graph** | `m16-component-registry.test.ts`, `m16-data-layer.test.ts`, `m16-page-generator.test.ts`, `m16-page-renderer.test.ts`, `m16-ref-resolver.test.ts`, `m16-schema.test.ts`, `m16-site-planner.test.ts`, `m16-worker-ui.test.ts`, `m16-wp-publisher.test.ts` | Integration | High |
| **Platform / companies** | `platform-companies.test.ts`, `platform-invitations.test.ts`, `platform-brand-*.test.ts`, `platform-notifications.test.ts` | Integration | Medium |
| **Route handlers** | `admin-batch-route.test.ts`, `admin-users-*.test.ts`, `briefs-run-routes.test.ts`, `briefs-commit-route.test.ts`, `cron-*.test.ts`, `tools-*.test.ts`, `posts-*.test.ts` | Unit (vi.mock) | Medium — thin routes are mocked; heavier logic tested via lib |
| **Infrastructure** | `logger.test.ts`, `health-route.test.ts`, `security-headers.test.ts`, `rate-limit.test.ts`, `redis.test.ts`, `encryption.test.ts`, `ssrf-guard.test.ts`, `env-validation.test.ts`, `middleware.test.ts` | Unit | High |
| **Images** | `image-library.test.ts`, `image-prompt-engine.test.ts`, `image-quality-check.test.ts`, `cloudflare-images.test.ts`, `images-embed.test.ts`, `html-image-rewrite.test.ts`, `istock-seed.test.ts`, `search-images.test.ts` | Mixed | Medium |
| **Design system** | `design-systems.test.ts`, `design-discovery-*.test.ts`, `build-injection.test.ts`, `build-injection-modes.test.ts`, `design-tokens.test.ts`, `kadence-*.test.ts` | Integration | High |
| **WordPress** | `wordpress.test.ts`, `wordpress-posts.test.ts`, `wordpress-fragment-passthrough.test.ts`, `kadence-rest.test.ts`, `kadence-palette-sync-lib.test.ts` | Integration (mocked WP HTTP) | Medium |
| **Optimiser** | `optimiser-publish-full-page.test.ts`, `optimiser-runner-import-mode.test.ts`, `optimiser-traffic-split-snippet.test.ts` | Unit | Low — optimiser module is newer, thinner coverage |
| **Pure utility** | `utils.test.ts`, `slug.test.ts`, `slugify.test.ts`, `html-size.test.ts`, `http.test.ts`, `breadcrumb.test.ts`, `scope-prefix.test.ts`, `encryption.test.ts` | Pure unit | High |

#### `components/__tests__/` (4 files) — Component + hook tests (jsdom)

| File | What it tests |
|---|---|
| `ConfirmActionModal.test.tsx` | Renders, opens, confirms, cancels |
| `data-table.test.tsx` | DataTable render, sorting, pagination |
| `use-poll.test.tsx` | `usePoll` hook — interval, stop-on-unmount |
| `brief-binary-decode.test.ts` | Binary → UTF-8 decoding utility |

Maturity: **Low** — 4 files covering ~4 components/hooks out of a large component tree. Everything else is tested at the route/lib layer or via E2E.

#### `e2e/` (32 spec files) — Playwright happy-path

Covers every major admin surface: auth, sites, users, batches, briefs, images, posts, social, platform, optimiser, navigation, appearance, design discovery, budget, and accessibility audits. All specs call `auditA11y(page, testInfo)` (axe-core, non-blocking). Maturity: **Medium-high** for admin surfaces; the social composer area is newer.

---

### 1c. Playwright / E2E tooling

Playwright is **installed and wired to CI**.

- Package: `@playwright/test: ^1.59.1` (dev dep)
- Axe integration: `@axe-core/playwright: ^4.11.3`
- Config: `playwright.config.ts` (repo root)
- Test directory: `./e2e/`
- CI: `.github/workflows/e2e.yml` — runs on every PR + push to main, 45-minute timeout
- Key config choices:
  - `fullyParallel: false`, `workers: 1` — serial execution (single Supabase stack)
  - `retries: 1` in CI, `0` locally
  - Single `chromium` project; no Firefox/WebKit
  - `webServer`: `npm run build && npm run start` in CI (production Next.js build), `npm run dev` locally
  - `globalSetup: ./e2e/global-setup.ts` — seeds deterministic admin + customer users + test site via service-role Supabase client
  - `globalTeardown: ./e2e/global-teardown.ts` — sweeps optimiser fixtures only; other data is intentionally left for dev iteration
  - Screenshot baselines pinned to Linux path template: `{testDir}/__screenshots__/{testFilePath}/{arg}-linux{ext}`

**Visual regression (Level 2):** infrastructure exists (`screenshots.spec.ts`, `screenshots.yml`, `vitest.components.config.ts` snapshot support). Deliberately deferred — baselines need one clean CI capture + commit. See `docs/testing-roadmap.md` §"Level 2".

---

### 1d. Test fixtures and factories

All fixtures live in `lib/__tests__/` helper files. Do not re-instantiate `createClient()` in test bodies — Rule #1 in `docs/architecture/RULES.md` is an explicit incident-driven prohibition.

**`lib/__tests__/_helpers.ts`** — DB seed factories:
- `seedSite(overrides?)` — inserts a `sites` row via service-role client; raises `tenant_cost_budgets` caps to 100 M cents so budget enforcement tests don't fire spuriously
- `randomPrefix()` — 4-char alphanumeric, matches the `sites.prefix` CHECK constraint
- `minimalComponentContentSchema()` — bare-minimum JSON Schema for component tests
- `minimalComposition()` — two-slot composition array for M16 tests

**`lib/__tests__/_auth-helpers.ts`** — Auth factories:
- `seedAuthUser(overrides?)` — `supabase.auth.admin.createUser()`, auto-reconciles role, tracks created IDs for cleanup, uses `${Date.now()}-${process.pid}` email prefix to avoid cross-file collisions
- `signInAs(user)` — throwaway supabase-js client signs in and returns the access token JWT; deliberately separate from the module-level service-role client to avoid polluting it with a user session
- `setFirstAdminEmail(email | null)` — upserts `opollo_config.first_admin_email` for bootstrap-rule tests
- `cleanupTrackedAuthUsers()` — sweeps via admin API; called from `beforeEach` (after truncateAll) and `afterAll`

**`lib/__tests__/_tools-route-helpers.ts`** — Request builders for `app/api/tools/*` route tests:
- `makeJsonRequest(body, url?)` — POST with JSON body
- `makeMalformedRequest(url?)` — POST with non-JSON body
- Minimal `RateLimitResult` fixtures

**`lib/__tests__/__fixtures__/briefs/`** — File-based fixtures (brief JSON payloads for parser tests)

**`lib/__tests__/_fixtures/`** — CSS token fixture files (`tokens-explicit-palette.css`, `tokens-leadsource.css`, `tokens-sparse.css`) for design-token tests

**`e2e/fixtures.ts`** — E2E seed constants: `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`, `E2E_TEST_SITE_PREFIX`, `E2E_CRON_SECRET`, `E2E_CUSTOMER_EMAIL`, `E2E_CUSTOMER_PASSWORD`, `E2E_CUSTOMER_COMPANY_SLUG`

**`e2e/global-setup.ts`** — idempotent seeding of admin + customer users + test site before the Playwright suite runs

---

### 1e. Mocks and stubs

`vi.mock()` is used **consistently** across the `lib/__tests__/` suite. Not ad-hoc — every route test that can't or shouldn't hit real Supabase mocks its dependencies explicitly.

**Most-mocked modules (frequency order):**

| Module | Why mocked |
|---|---|
| `@/lib/auth` | Route tests don't want a real auth check |
| `@/lib/admin-api-gate` | Return a fake `{ ok: true }` to bypass admin check |
| `@/lib/supabase` | Some tests mock the DB client entirely; integration tests don't |
| `@/lib/logger` | Silence output; assert log calls |
| `next/headers` | `cookies()` / `headers()` not available outside Next.js runtime |
| `next/cache` | `revalidatePath()` / `revalidateTag()` are no-ops in tests |
| `@/lib/rate-limit` | Bypass rate limiting in route tests |
| `@/lib/sites` | Some tests mock the sites layer to inject specific return values |
| `@anthropic-ai/sdk` | Brief-runner tests mock Anthropic to return canned HTML |

**Stubs for module boundaries** (vitest alias table in both configs):
- `lib/__tests__/_server-only-stub.ts` — empty module replacing `server-only` so server-gated imports resolve in the test worker without Next.js's `react-server` export condition
- `components/__tests__/_next-navigation-stub.ts` — `useRouter`, `usePathname`, `useSearchParams` no-ops
- `components/__tests__/_next-font-stub.ts` — `Inter()` etc. return `{ className: '' }`
- `components/__tests__/_pdf-parse-stub.ts` — returns empty parse result
- `components/__tests__/_mammoth-stub.ts` — returns empty conversion result

**Two-tier pattern:** integration tests hit real Supabase (the setup/teardown harness handles isolation); route-unit tests mock everything at the `vi.mock()` layer. The distinction is not enforced by directory — it's emergent from whether the test calls `getServiceRoleClient()`.

---

## 2. CI and tooling

### 2a. CI workflows

| Workflow | File | Triggers | What runs |
|---|---|---|---|
| **CI** | `ci.yml` | PR (opened/sync) + push to main | `migration-versions` (duplicate prefix check), `typecheck`, `lint` + `lint:css`, `static-audit` (gated on lint+typecheck), `build`, `test-components` (jsdom, no Supabase), `test` (Vitest + Supabase stack, 50-min timeout). Vitest failure posts tail of output as PR comment. |
| **E2E** | `e2e.yml` | PR + push to main + `workflow_dispatch` | Supabase start, build Next.js, Playwright chromium, upload report + traces. 45-min timeout. |
| **Screenshots** | `screenshots.yml` | PR (compare mode) + push to main (baseline) + `workflow_dispatch` (UPDATE_SNAPSHOTS=true) | Visual regression diff vs committed baselines in `e2e/__screenshots__/`. Currently no committed baselines → gate inactive. |
| **Lighthouse** | `lighthouse.yml` | PR + `workflow_dispatch` | `npm run build` + LHCI against `/login`. Perf/CWV = `warn`; A11y + best-practices = `error`. |
| **Dependency audit** | `audit.yml` | Push + PR + weekly cron | `npm audit` — blocks on critical CVEs in prod, informational at high. |
| **CodeQL** | `codeql.yml` | Push + PR + weekly cron | SAST (JavaScript/TypeScript). |
| **Secret scan** | `gitleaks.yml` | Push + PR | `gitleaks` with `.gitleaks.toml` allow-list for deterministic test keys + local Supabase JWTs. |
| **Release** | `release-please.yml` | Push to main | Aggregates conventional commits → Release PR → GitHub Release + git tag. |
| **Deploy migrations** | `deploy-migrations.yml` | Manual / triggered | `supabase db push` to staging/prod. |

**Branch protection:** `gh api .../branches/main/protection` returns `{}` for `required_status_checks`. No checks are required for merge at the GitHub settings level. Auto-merge fires immediately when the merge button condition is met, not after CI. **Implication for new work:** always poll `gh pr checks` until green before calling `--squash` — `--auto` is not safe here (documented in project memory).

**Forked-repo PRs:** all workflows gate on `github.event.pull_request.head.repo.full_name == github.repository`. Forked PRs skip every job.

---

### 2b. Pre-commit hooks

Husky v9. Hooks install via `prepare` in `package.json`.

**`.husky/pre-commit`:**
```sh
npx lint-staged
```

**`.lintstagedrc`** (JSON, project root):
```json
{
  "*.{ts,tsx}": ["eslint --fix --max-warnings=0"],
  "*.{js,jsx,mjs,cjs}": ["eslint --fix --max-warnings=0"],
  "seed/**/*.css": ["stylelint --fix"]
}
```

Lint-staged runs ESLint auto-fix then fails the commit if any warning remains. `--max-warnings=0` means zero tolerance.

**`.husky/commit-msg`:**
```sh
npx --no-install commitlint --edit "$1"
```

Config in `.commitlintrc.cjs`. Enforces Conventional Commits (`feat|fix|chore|refactor|docs|test|perf|build|ci|revert`). Header cap: 100 chars.

No push hook. No test-on-commit hook (tests are too slow for pre-commit; they run in CI only).

---

### 2c. Lint and typecheck

- `npm run lint` → `next lint` (ESLint with `eslint-config-next`). Runs in CI `lint` job.
- `npm run lint:css` → `stylelint 'seed/**/*.css'`. Also runs in CI `lint` job.
- `npm run typecheck` → `tsc --noEmit`. CI `typecheck` job.
- No lint rules specifically for tests (no `no-only-tests`, no mandatory describe blocks in ESLint config).
- `vitest.components.config.ts` sets `globals: true` (so `describe`/`it`/`expect` are available without imports in component tests). `vitest.config.ts` does not set globals — test files must import from `vitest` explicitly.

---

## 3. Conventions and existing docs

### 3a. CLAUDE.md

Exists at repo root — large, canonical. Key testing-relevant excerpts:

- `npm run test` → Vitest, `npm run test:coverage` → Vitest + V8 coverage (60% line / 55% branch baseline), `npm run test:e2e` → Playwright (requires `supabase start`), `npm run test:components` → jsdom suite (no Supabase).
- "After any change: run lint, typecheck, and build. Fix failures yourself before reporting back."
- "Every PR that adds or substantially changes an admin-facing route, form, or action MUST include a Playwright spec for its happy path."
- "Every spec navigates to every page it touches and runs `auditA11y(page, testInfo)`."
- Retry ceiling: 10 attempts per PR, escalate on same-failure-twice.

### 3b. docs/architecture/RULES.md

Nine incident-derived rules. Rules with direct test implications:

- **Rule #1:** Use `getServiceRoleClient()` from `_helpers.ts` / `_auth-helpers.ts`; never instantiate `createClient()` inline in a test body. Incident: leaked client caused Supabase advisory lock contention.
- **Rule #2:** `supabase/config.toml` must declare `[auth.email] enable_signups = true` for fresh stacks; not enforced at test time but critical for CI.
- **Rule #8:** `npm run audit:static` HIGH must be zero before merge.

### 3c. docs/patterns/ (relevant testing patterns)

| Pattern file | Summary |
|---|---|
| `pure-unit-test.md` | When to use `vi.mock()` vs integration. File location, test shape. |
| `concurrency-test-harness.md` | `Promise.all` pattern for M3-style N-worker contention tests. |
| `playwright-e2e-coverage.md` | Per-spec structure, required files, helper usage. |
| `rls-policy-test-matrix.md` | How to write RLS gate tests — owner/non-owner/anon triples. |
| `component-hook-test.md` | jsdom component tests, `vitest.components.config.ts` usage. |

### 3d. docs/testing-roadmap.md

Explicit status table of testing ladder levels:

| Level | Status |
|---|---|
| 1 — Playwright happy-path E2E | **Shipped** |
| 2 — Visual regression (`toHaveScreenshot`) | **Deferred** — infrastructure exists, baselines not committed |
| 3 — Accessibility + keyboard | **Partial** — axe-core runs but non-blocking; keyboard nav not written |
| 4 — Property-based / fuzz | **Deferred** |
| 5 — Load + concurrency (production-like) | **Deferred** — needs staging Supabase |
| 6 — Chaos / failure injection | **Deferred indefinitely** |
| 7 — Synthetic production monitoring | **Deferred until launch** |

### 3e. PR template / CODEOWNERS

- **No `.github/pull_request_template.md`** — does not exist.
- **No `CODEOWNERS`** — does not exist.

---

## 4. Code surface

### 4a. API routes

**Total: 204 `route.ts` files** under `app/api/`.

| Feature area | Route count | Notes |
|---|---|---|
| `cron/` | 27 | Background jobs: process-batch, brief-runner, regenerations, render-pages, budget-reset, optimiser-* (12 cron routes), social-publish-backfill/watchdog |
| `admin/sites/[id]/setup/` | 12 | Design discovery wizard routes |
| `sites/[id]/` | 12 | Site-level operations: appearance, blueprints, posts, purge, test-connection, wp-pages/taxonomies/users |
| `platform/social/posts/[id]/` | 11 | Approval flow: submit, approve, reject, request-changes, cancel-approval, reopen, schedule, variants, recipients |
| `auth/` | 9 | Login, logout, callback, forgot/reset password, ping, challenge, accept-invite |
| `optimiser/clients/[id]/` | 7 | Optimiser client management |
| `tools/` | 7 | WP page CRUD + image search (AI tool-calling surface) |
| `admin/images/` + `admin/images/[id]/` | 10 | Upload, list, download, restore, hard-delete, reextract |
| `platform/social/` | 5 | Connections, media, CAP generate/image/assist |
| `optimiser/proposals/[id]/` | 5 | Approve, reject, rollback, create-variant, run-status |
| `design-systems/[id]/` | 5 | Components, templates, preview, activate, archive |
| `admin/` | 5 | Batch, companies, design-system-settings, email-test |
| `admin/sites/[id]/` | 4 | Budget, onboarding, page regeneration, regenerate |
| `briefs/[brief_id]/` | 4 | Run, commit, cancel, pages + approve/revise |
| `platform/social/connections/` | 4 | Connect, reconnect, callback, sync |
| Various | remainder | account, approve, platform/brand, platform/notifications, optimiser/oauth, webhooks/bundlesocial, webhooks/qstash, health, emergency |

### 4b. External integrations (outbound network calls)

| SDK / service | Package | Usage |
|---|---|---|
| Anthropic (Claude API) | `@anthropic-ai/sdk ^0.93.0` | Brief runner, optimiser evaluation, design discovery, image prompt engine, CAP generator |
| bundle.social | `bundlesocial ^2.47.0` | Social post publishing, connection management, webhooks |
| SendGrid | `@sendgrid/mail ^8.1.6` | Transactional email (`lib/email/sendgrid.ts` only) |
| Upstash Redis | `@upstash/redis ^1.37.0` | Session/rate-limit/draft persistence |
| Upstash QStash | `@upstash/qstash ^2.10.1` | Async job queue (social publish) |
| Upstash Ratelimit | `@upstash/ratelimit ^2.0.8` | API rate limiting |
| Supabase | `@supabase/supabase-js ^2.105.3` | Database + auth |
| Cloudflare Images | via `fetch()` | Image upload and transformation |
| Langfuse | `langfuse ^3.38.20` | LLM observability |
| Axiom | `@axiomhq/js ^1.6.0` | Structured log transport |
| Sentry | `@sentry/nextjs ^10.51.0` | Error tracking |
| Microlink | via `fetch()` | Screenshot capture for design discovery |
| WordPress REST API | via `fetch()` | Page/post CRUD, media upload, Kadence palette sync |
| iStock | via `fetch()` (estimated) | Image search |
| SSH2 / SFTP | `ssh2-sftp-client ^12.1.1` | Static hosting file transfer |
| Google Ads / GA4 / Clarity | via `fetch()` | Optimiser data ingestion |
| Vercel Logs | via `fetch()` | Optimiser traffic analysis |

### 4c. Critical user journeys (from route structure + app pages)

Inferred from `app/(...)*/page.tsx` tree and API surface:

1. **Authentication** — sign in, sign out, forgot/reset password, session expiry warning, 2FA challenge, accept invite (`/login`, `/auth/*`)
2. **Site management** — create site, configure WP credentials, test connection, set mode (copy_existing / new_design), purge (`/admin/sites/*`)
3. **Brief generation** — upload brief, run generation loop (tick-by-tick via cron), review/approve/revise pages, commit to WordPress (`/admin/sites/[id]/briefs/*`)
4. **Batch processing** — create batch, process via cron worker, cancel in-flight (`/admin/batch/*`)
5. **Social post composer** — create post, add variants, schedule, submit for approval, approve/reject, publish via bundle.social (`/company/social/*`)
6. **Blog post authoring** — create post, auto-save, SEO panel, publish/unpublish to WordPress (`/admin/sites/[id]/posts/*`)
7. **Image library** — upload images, bulk import, search/embed in briefs, generate AI images (`/admin/images/*`, `/company/images/*`)
8. **Design system authoring** — design discovery wizard (new_design) or CSS extraction wizard (copy_existing), Kadence palette sync, appearance panel (`/admin/sites/[id]/setup/*`, `/admin/sites/[id]/appearance`)
9. **Platform / companies** — create company, invite users, switch company context, accept invitation (`/company/*`, `/platform/*`)
10. **Optimiser** — onboard a client (Google Ads + GA4), import landing pages, score alignment, create proposals, A/B test rollout, change log (`/optimiser/*`)

---

## 5. Known gaps and pain points

### 5a. Skipped tests

| Location | What | Count |
|---|---|---|
| `e2e/blog-styling-gate.spec.ts:39,44,49,62` | 4 `test.skip()` calls — blog styling gate tests | 4 |
| `e2e/screenshots.spec.ts:249` | All screenshot tests skip unless `RUN_SCREENSHOTS=1` | All tests in file |

No `it.skip`, `describe.skip`, `xit`, or `xdescribe` in `lib/__tests__/`. The `lib/__tests__/` suite is clean in this regard — the test debt was admitted via "fix: clean up test debt" commits (two in the last 30 days), not via skips.

### 5b. Recent regression clusters (last 30 days)

Commits on `fix(`, `revert`, and `fix: clean up test debt` since 2026-04-09:

| Area | Fix commits | Signal |
|---|---|---|
| **spec22 social composer** | 6 hotfixes (`fix(spec22):`): BOM in migrations, enum bug, super_admin enum, loading spinner, token violations, calendar contrast | New code shipped faster than tests followed; high regression density in this area |
| **Test debt** | 2 PRs (`fix: clean up test debt`): 9 failing tests (#777), 5 failing groups (#771) | Tests were broken and needed bulk repair — suggests schema drift or hook changes caused cascades |
| **Social connections / portal** | 2 PRs (`fix(social):`): tokenless URL guard, de-dupe portal link | bundle.social integration is fragile; new guards added reactively |
| **E2E DraftRestoreBanner** | 3 consecutive PRs (#707, #708, #709) | A layout refactor dropped a component; E2E caught it but took 3 fixes to stabilise |
| **Redis mock TDZ** | 2 PRs (#710, #711) | `vi.hoisted` / TDZ issue in `redis.test.ts`; test infrastructure bug not production bug |

---

## 6. Constraints to respect

### 6a. Vercel + Supabase

- Deploy target: **Vercel** (confirmed: `next.config.js`, build scripts, `@sentry/nextjs`).
- Database/auth: **Supabase** (`@supabase/supabase-js`, `@supabase/ssr`, `supabase/config.toml`, migrations in `supabase/migrations/`).
- Secrets: `.env.local` for local dev. `.env.example` documents every required variable. `.env.local.example` is the richer annotated version. Never `echo` values — see Rules.md #9 + project memory.
- Test stack: local `supabase start` (Docker). CI starts a fresh stack per run. No staging project yet (`docs/testing-roadmap.md` §"Why Playwright runs against localhost").

### 6b. Branch and merge conventions

- Branch prefix: `feat/`, `fix/`, `chore/`, `refactor/`, etc. — conventional prefix maps to commit type.
- Always open a PR; direct pushes to `main` are bypassed by the Claude Code auto-continue loop but not by branch protection (no required checks).
- **Merge method:** squash (`--squash`). Never `--auto` — branch protection has no required checks so `--auto` fires immediately without CI. Poll `gh pr checks` until all green, then call `gh pr merge --squash`.
- `release-please.yml` monitors main and creates CHANGELOG / Release PRs from conventional commits.

### 6c. Things I'd push back on in a new test harness plan

**These are already built — don't rebuild them:**

1. **Supabase bootstrap / credential extraction** — `_globalSetup.ts` + `_supabase-status.ts` already handle cold start, defensive JSON/text fallback, and env injection. Any plan that re-implements "boot Supabase before tests" is duplicating ~200 lines of battle-tested code.

2. **Per-test truncation** — `_setup.ts` already TRUNCATEs all 35+ tables with the correct ordering and the auth user cleanup pattern (direct Postgres, not TRUNCATE auth.users CASCADE, for the advisory-lock reason documented in Rules.md #1). Don't introduce a second isolation layer.

3. **Seed factory API** — `seedSite()` and `seedAuthUser()` + `signInAs()` cover the primary fixtures. Any plan proposing new factory helpers should check these first.

4. **The integration/component split** — already exists as two separate vitest configs. No further split is needed. A "unit test" in this codebase means "a test in `lib/__tests__/` that mocks its deps with `vi.mock()`", not a file in a separate directory.

5. **E2E global setup** — `e2e/global-setup.ts` already seeds admin + customer users + test site idempotently. Don't duplicate.

6. **Visual regression infrastructure** — `screenshots.spec.ts` and `screenshots.yml` exist. The gap is committed baselines, not code. A plan that proposes "add Playwright screenshot tests" needs to account for the baseline-capture workflow in `screenshots.yml`, not write new snapshot infrastructure from scratch.

7. **`vi.mock()` for bundlesocial / Anthropic** — already done in the social and brief-runner test files. Any new social or AI test should grep for an existing mock of the same module before writing a new one.

**Genuine gaps worth addressing in a new plan:**

- `components/__tests__/`: only 4 files covering a large component tree. Many interactive components (modals, forms, the composer, DataTable variants) have zero component-layer coverage.
- Optimiser module test coverage is thin (3 test files vs ~25+ `lib/optimiser/*.ts` files and 40+ `app/api/optimiser/*` routes).
- Social composer (spec22) has repeatedly broken under hotfixes. A dedicated set of unit tests for the composer state machine and the bundle.social publish path would pay down the regression debt.
- Visual regression baselines not yet committed — the CI workflow exists but produces artifacts instead of failing PRs, because `e2e/__screenshots__/` is empty.
- `e2e/blog-styling-gate.spec.ts` has 4 `test.skip()` calls with no committed follow-up to un-skip them.
