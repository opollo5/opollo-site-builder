# Test Coverage Target — Phase A audit (2026-05-09)

This is the gap matrix the seven-layer harness is being built against.
Builds on `docs/test-harness-recon.md`. That doc inventories what
exists; this one says what's missing and where the highest risk lives.

Re-verify before acting on any claim older than ~one milestone.

---

## 0. Layer model (recap)

| # | Layer | Tool | Where | npm script | CI status check |
|---|---|---|---|---|---|
| 1 | Unit | Vitest | `lib/**/*.test.ts`, `lib/__tests__/*.test.ts` (mocked) | `test:unit` *(new alias)* | `test-unit` *(new)* |
| 2 | Contract | Vitest + frozen snapshots | `lib/__tests__/*.contract.test.ts` *(new convention)* | `test:contract` *(new)* | `test-contract` *(new)* |
| 3 | Integration | Vitest + real Supabase | `lib/__tests__/*.test.ts` (calls `getServiceRoleClient()`), `app/api/**/*.integration.test.ts` *(new convention for routes)* | `test:integration` *(new alias)* | `test-integration` *(new)* |
| 4 | Component | Vitest jsdom | `components/__tests__/**/*.test.{ts,tsx}` | `test:components` (existing) | `test-components` (existing) |
| 5 | E2E | Playwright | `e2e/*.spec.ts` | `test:e2e` (existing) | `e2e` (existing) |
| 6 | Security | Vitest + bespoke harnesses | `lib/__tests__/security/**/*.security.test.ts`, `tests/security/**/*.test.ts` *(new)* | `test:security` *(new)* | `test-security` *(new)* |
| 7 | Live probes + smoke | Standalone scripts + Playwright | `scripts/probes/*.ts`, `e2e/smoke/*.spec.ts` *(new)* | `test:smoke` *(new)*, manual probes | `smoke` *(new, post-deploy)* |

**Today**: layers 1, 3, 4, 5 exist (mixed). Layers 2, 6, 7 are absent
or partial. The split between Layer 1 and Layer 3 today is emergent
(does the test call `getServiceRoleClient()`?), not enforced by config.

---

## 1. Coverage matrix — API routes × layer

204 `app/api/**/route.ts` files. Audit summarised by feature area
because per-route enumeration would balloon this doc; risky areas are
listed at the file level.

Legend: ● full • partial ○ none.

| Feature area | Routes | Unit/Integration | Contract | E2E | Security | Notes |
|---|---:|---|---|---|---|---|
| `auth/*` | 9 | ● | ○ | ● (`auth.spec.ts`, `auth-passwords.spec.ts`) | • (no cross-tenant sweep) | Login, accept-invite, callback, password reset all have integration coverage. Missing: contract snapshots for the Supabase auth client calls, brute-force rate-limit assertions through real middleware. |
| `webhooks/bundlesocial` | 1 | ● (`social-webhooks-bundlesocial.test.ts`) | ○ | ○ | • (signature mocked, not exploit-driven) | **Phase B canary**. Need: contract snapshot of envelopes we accept, real-signature reject test, idempotency assertion under retry. |
| `webhooks/qstash/social-publish` | 1 | • | ○ | ○ | ○ | QStash signature verification untested in isolation. |
| `platform/social/connections/*` | 4 | ● | ○ | • (`social.spec.ts` happy path) | ○ | **Phase B canary**. `callback?company_id=X` query-param-trust regression must be pinned. |
| `platform/social/posts/*` | 16 | ● (transitions, approvals, variants, recipients) | ○ | • (`social.spec.ts`) | • (RLS tested per-table; per-route cross-tenant sweep missing) | High churn area — the spec22 fixes. |
| `platform/social/cap/*` | 3 | ○ | ○ | ○ | ○ | CAP generator routes — Anthropic-driven. **Prompt-injection coverage is zero.** |
| `platform/social/drafts/*`, `media/*`, `viewer-links/*` | 6 | • | ○ | ○ | ○ | Draft persistence + media upload — XSS risk on user content. |
| `optimiser/*` | 40+ | ○ (3 lib tests cover thin slices) | ○ | • (4 e2e specs — onboarding, page-browser, proposal-review, change-log) | ○ | **Largest gap.** OAuth callback security, prompt injection on URL/copy fields, SSRF on outbound page fetches. |
| `admin/sites/[id]/setup/*` | 12 | ● | ○ | • (`design-discovery.spec.ts`, `site-setup.spec.ts`) | ○ | Design-discovery & extraction routes hit Microlink + Anthropic — SSRF + prompt-injection surface. |
| `admin/sites/[id]/pages/*` | 4 | ● | ○ | • | ○ | Page regeneration — workers tested, route layer thinner. |
| `admin/users/*`, `admin/companies/*`, `admin/invites/*` | 7 | ● (`admin-users-*`, `platform-companies`, `platform-invitations`) | ○ | • (`users.spec.ts`, `platform-companies.spec.ts`) | ● (RLS + role-gate tests exist) | Strong area. |
| `admin/images/*`, `tools/*` (image search) | 12 | • | ○ | • (`images.spec.ts`, `images-new.spec.ts`) | ○ | iStock + Cloudflare upload paths — no contract snapshots; SSRF surface on `images/fetch-url`. |
| `cron/*` | 27 | ● (batch, brief-runner, optimiser-* batch) | ○ | ○ | • (most enforce shared-secret header) | Coverage is by lib tests, not by route handler tests. |
| `briefs/*`, `admin/batch/*` | 7 | ● (batch-create, batch-cancel, brief-runner) | ○ | • (`briefs-full-loop`, `batches`) | ● (RLS) | Strongest area in the codebase. |
| `account/*`, `auth/challenge*` | 4 | • | ○ | • (`auth-passwords.spec.ts`) | • | Device sign-out + password change — needs CSRF assertion through real flow. |
| `health`, `emergency`, `approve/[token]` | 3 | • | ○ | ○ | ○ | Magic-link approve route — token-binding unverified at route layer. |
| `platform/brand/*`, `platform/notifications/*`, `platform/social/publish-attempts/*` | ~10 | • | ○ | ○ | ○ | Mixed — see lib tests. |

### Top gaps by risk

Highest first. Each item is a Phase B/C/D candidate.

1. **bundle.social full chain** — connect → callback → posts → publish-attempts → webhook. Eight regression cases in §6 below. *Phase B*.
2. **Multi-tenant cross-company sweep on every social/optimiser/admin route**. We have RLS gate tests at the table layer; we don't have a route-level matrix that proves Company A admin gets 403/404 on a Company B resource. *Phase C → D*.
3. **Optimiser route layer**. 40+ routes, near-zero route-level tests. Plus prompt injection on copy fields, SSRF on `page-import/fetch-source`. *Phase D*.
4. **Webhook signature audits** for `qstash/social-publish` (currently signature is verified but the failure path isn't asserted). *Phase D*.
5. **CAP generator prompt injection** — `platform/social/cap/{generate,assist,generate-image}`. The fields flow into Anthropic. *Phase D*.
6. **Image route SSRF** — `admin/images/fetch-url`, `tools/search-images` (iStock), `optimiser/page-import/fetch-source`. The SSRF guard exists at `lib/ssrf-guard.ts`; route-level enforcement assertions are partial. *Phase D*.

---

## 2. External SDKs × contract status

| Service | Where called | SDK | Contract snapshot today? | Probe today? | Phase |
|---|---|---|---|---|---|
| **bundle.social** | `lib/bundlesocial.ts`, `lib/platform/social/**`, `app/api/webhooks/bundlesocial` | `bundlesocial` | ○ | ○ | B |
| **Anthropic** | `lib/brief-runner.ts`, `lib/system-prompt.ts`, `lib/platform/social/cap/*`, `lib/optimiser/*`, `lib/image-prompt-engine.ts`, `lib/design-discovery/*` | `@anthropic-ai/sdk` | ○ (mocked in unit tests) | ○ | C |
| **SendGrid** | `lib/email/sendgrid.ts` only | `@sendgrid/mail` | ○ | ○ | D |
| **Upstash Redis / Ratelimit / QStash** | `lib/redis.ts`, `lib/rate-limit.ts`, `lib/qstash.ts` | `@upstash/*` | ○ | ○ | D |
| **Cloudflare Images** | `lib/cloudflare-images.ts` | `fetch()` | ○ | ○ | D |
| **WordPress REST** | `lib/wordpress.ts`, `lib/kadence-rest.ts`, `lib/wp-featured-media.ts` | `fetch()` | ○ (mocked HTTP) | ○ | D |
| **Microlink** | `lib/full-page-chrome-extractor.ts`, design-discovery extract | `fetch()` | ○ | ○ | D |
| **iStock** | `lib/search-images.ts` (estimated) | `fetch()` | ○ | ○ | D |
| **SSH/SFTP** | `ssh2-sftp-client` | static-host transfer | ○ | ○ | E (deferred — internal infra) |
| **Google Ads / GA4 / Clarity / Vercel Logs** | `lib/optimiser/sync/*` | `fetch()` + OAuth | ○ | ○ | D (optimiser slice) |
| **Langfuse / Axiom / Sentry** | observability transports | SDKs | n/a (output-side, no contract value) | n/a | — |

### What "contract snapshot" means here

A test under `lib/__tests__/<feature>.contract.test.ts` that:

1. Spies on the outbound HTTP call (or mocks the SDK at the boundary).
2. Drives the production code path with a stable input.
3. Asserts the exact outgoing payload (URL, method, headers, body) against a frozen snapshot file under `__snapshots__/`.
4. Snapshot is a committed artefact reviewed in PRs the way migrations are reviewed.

PR #814's duplicate `LINKEDIN` would have failed the
`bundlesocial-create-portal-link` snapshot the moment the dedup line
was removed.

---

## 3. Critical user journeys × E2E coverage

| Journey | Spec | Coverage | Smoke (post-deploy) |
|---|---|---|---|
| Sign in → home | `auth.spec.ts`, `navigation.spec.ts` | ● | ○ (Phase E) |
| Forgot password / reset | `auth-passwords.spec.ts` | ● | ○ |
| Accept invite | covered in `users.spec.ts` | • | ○ |
| Create site → set mode → connect WP | `sites.spec.ts`, `site-setup.spec.ts` | ● | ○ |
| Design discovery wizard (new_design) | `design-discovery.spec.ts` | ● | ○ |
| Copy-existing extraction | `site-setup.spec.ts` | • | ○ |
| Brief create → run loop → review → commit | `briefs-full-loop.spec.ts`, `briefs-run-surface.spec.ts`, `briefs-review.spec.ts`, `pages.spec.ts` | ● | ○ |
| Batch process → cancel | `batches.spec.ts` | ● | ○ |
| **Social composer → connect → schedule → publish** | `social.spec.ts` | • (composer thin) | ○ (Phase E target) |
| Blog post authoring | `posts.spec.ts`, `posts-new.spec.ts`, `posts-pipeline.spec.ts` | ● | ○ |
| Image upload + library | `images.spec.ts`, `images-new.spec.ts` | ● | ○ |
| Optimiser onboard → import → score → propose → review | `optimiser-*.spec.ts` (4 files) | • | ○ |
| Platform companies + brand profile | `platform-companies.spec.ts`, `customer-brand-profile.spec.ts` | ● | ○ |
| Appearance / Kadence sync | `appearance.spec.ts` | ● | ○ |
| Budgets | `budgets.spec.ts` | ● | ○ |
| Admin users | `users.spec.ts`, `sites-admin-table.spec.ts`, `sites-admin-delete.spec.ts` | ● | ○ |
| M16 site-graph | `m16-site-graph.spec.ts` | ● | ○ |

**Visual regression**: `e2e/screenshots.spec.ts` exists; gates only when
`RUN_SCREENSHOTS=1`. Baselines not committed → gate inactive. *Phase D*.

**Skips today**: `e2e/blog-styling-gate.spec.ts:39,44,49,62` — 4
`test.skip()` calls. Resolve in *Phase D*.

---

## 4. Security class × current state

Drives layer 6.

| Class | State today | What's missing | Phase |
|---|---|---|---|
| **6.1 AuthN/AuthZ per route** | • RLS at table layer extensively covered. Per-route auth-failure path tested for routes with route-unit tests; many routes only tested via lib layer. | Sweep helper that hits every route as anon / authenticated-non-admin / cross-tenant admin and asserts the rejection. `seedTwoCompanies()` factory. | C |
| **6.2 Multi-tenant data isolation** | • RLS gate tests for tables. Direct DB read-as-userA-against-companyB tests are partial. Bundle.social `callback?company_id=X` regression not pinned. | Cross-tenant sweep for the eight high-risk routes (social posts, social connections, optimiser, admin/sites). Pin the callback regression. | B (callback) → C (sweep) |
| **6.3 Input validation / injection** | ● Most routes use Zod. Validation-failure paths exist in lib tests. SQL injection: relies on PostgREST + parameterised queries — no explicit assertion that a `' OR 1=1` payload is sanitised by the boundary. Prompt injection: ○. SSRF: `lib/ssrf-guard.ts` exists, route-level assertions partial. | `tests/security/sql-injection-payloads.ts`, `prompt-injection-payloads.ts`, `ssrf-payloads.ts` reusable lists. Apply to `cap/*`, `optimiser/page-import`, `images/fetch-url`. | C/D |
| **6.4 XSS** | • `dangerouslySetInnerHTML` appears in 3 prod components (`PostDetailClient.tsx`, `ConceptReviewCards.tsx`, `app/layout.tsx` — preload links). Composer renders user-typed text via React (escaped by default). | Component-layer XSS tests for composer, post detail, concept review. Justifying comment on each `dangerouslySetInnerHTML`. | C/D |
| **6.5 CSRF** | • SameSite cookies via Supabase SSR. State-changing routes are POST/PATCH/DELETE. No assertion of cross-origin rejection. | Real cross-origin request → assert rejection on a sample of state-changing routes (auth, change-password, social post create). | C |
| **6.6 Rate limiting / brute force** | ● `lib/rate-limit.ts` + `rate-limit.test.ts` exist. Login route — needs hammering test against real middleware. | Per-route rate-limit assertion harness. Hammering test for login + reset. | C/D |
| **6.7 Secrets / info disclosure** | ● gitleaks runs in CI on every push. Production error envelope tested at unit layer. Production bundle is *not* greppable for secret patterns in CI. | `bundle-secret-scan` step in CI: build, grep `.next/**` for `BUNDLE_SOCIAL_API`, `OPOLLO_MASTER_KEY`, etc. gitleaks history sweep. | D |
| **6.8 Webhook authenticity** | ● `verifyBundlesocialSignature` exists with HMAC-SHA256 + timing-safe compare; `processBundlesocialWebhook` rejects invalid. | Test that drives a *real-signed* payload through the route, plus a *deliberately wrong-signed* payload, asserts both outcomes against the running route. Audit `qstash/social-publish` similarly. | B (bundle) → D (qstash) |
| **6.9 Dependency vulns** | ● `audit.yml` blocks on critical, informational at high. Dependabot weekly. | Tighten to `--audit-level=high` once Next.js framework upgrade lands (already noted in CLAUDE.md). Add Renovate later if Dependabot churn exceeds budget. | F (CI gate) |
| **6.10 Static analysis** | ● CodeQL on every push. ESLint + `next lint`. No Semgrep. | Add Semgrep with OWASP Top 10 + React rules. Tune false positives within budget; if noisy, document gap and proceed. | D (best-effort) |
| **6.11 Headers / transport** | ● `lib/security-headers.ts` is single source of truth. CSP is report-only. | Live-probe assertion against deployed preview confirms headers present. Tighten CSP from report-only when stable. | E (smoke) |
| **6.12 Accessibility** | ● Axe runs on every spec, non-blocking. Promote to blocking on critical journeys: login, signup, post composer, social connect. | Promote 4 critical journeys. Continue non-blocking elsewhere. | F |

---

## 5. Cross-cutting systems × current state

| System | State today | Gap | Phase |
|---|---|---|---|
| **Live diagnostic protocol** | ○ — no codified six-step protocol; agents have invoked "third-party bug" without it. | Codify in `CLAUDE.md` + `docs/diagnostic-protocol.md`. Probe scripts under `scripts/probes/`. | C/F |
| **Post-deploy production smoke** | ○ — `e2e/smoke/` does not exist. Vercel deploy hook not wired. No designated production smoke-test user. | Build `e2e/smoke/*.spec.ts`, wire `.github/workflows/smoke.yml` driven by Vercel deploy hook + `repository_dispatch`. **Blocker**: needs production smoke-test user credentials provisioned by Steven (single batched ask in §7). | E |
| **Auto-hotfix on smoke failure** | ○ | GH Action that on smoke failure: creates `hotfix/smoke-failure-<ts>` branch, commits `docs/incidents/<ts>.md`, opens issue, posts notification, optionally rolls back via Vercel API. | E |
| **Config-drift detector** | ○ — webhook URL drift (opollo.vercel.app vs opollo-site-builder.vercel.app) was the canary. | Daily GH Action: queries bundle.social API for registered webhook URL, compares to constant `PRODUCTION_WEBHOOK_URL`, opens issue on drift. | E |
| **Regression-pinning** | ○ as a category — fixes go in but no `tests/regressions/` discipline. | Convention: every multi-fix bug gets `tests/regressions/<bug-slug>.test.ts` before final fix merges. Eight bundle.social regressions retroactively. | B (8 regressions) → F (rule) |

---

## 6. Eight retroactive regression tests for the bundle.social outage

To be pinned in `tests/regressions/` during Phase B + Phase E.

| # | Slug | Layer | Asserts |
|---|---|---|---|
| R1 | `bundle-social-no-duplicate-platforms` | Contract | `socialAccountTypes` to `socialAccountCreatePortalLink` has no duplicates, even if both `linkedin_personal` and `linkedin_company` are requested or fallback fires. |
| R2 | `bundle-social-tokenless-url-rejected` | Integration | When the SDK returns a URL without a query string, `initiateBundlesocialConnect` returns `{ ok: false, code: "INTERNAL_ERROR" }` rather than 200 + broken URL. |
| R3 | `bundle-social-connect-body-shape` | Contract | Composer connect button request body shape ≡ `POST /api/platform/social/connections/connect` Zod schema. Pinned both ends. |
| R4 | `bundle-social-webhook-url-drift` | Drift detector + Integration | Webhook URL fetched from bundle.social's API equals `${PRODUCTION_DOMAIN}/api/webhooks/bundlesocial`. |
| R5 | `git-tree-clean-before-commit` | Pre-commit hook + CI step | Pre-commit hook errors if there are unstaged changes that the commit message references. (Detects "fix wasn't pushed".) |
| R6 | `bundle-social-initiate-logs-payload` | Integration | `initiateBundlesocialConnect` emits the documented `bundlesocial.initiate_connect.{request,response}` log lines via the production logger; integration test captures via `logger.test.ts` style spy. |
| R7 | `bundle-social-env-vars-present` | Drift detector | Daily check: `BUNDLE_SOCIAL_API` and `BUNDLE_SOCIAL_TEAMID` resolve and are non-empty in production. Verified via a side-channel: deployed `/api/health` returns a degraded subkey. |
| R8 | `deploy-sha-matches-main` | Smoke + drift detector | Within 10 minutes of merge to `main`, production deploy SHA equals `main` HEAD. (Uses `vercel inspect` or the deploy hook payload.) |

---

## 7. Single batched ask to Steven

Per the directive, blockers escalate exactly once.

These are the credentials/decisions only Steven can supply. Phases not
listed here proceed without intervention.

1. **Production smoke-test user**. Need: `SMOKE_USER_EMAIL`, `SMOKE_USER_PASSWORD` provisioned in production Supabase, attached to a stable test company (`SMOKE_COMPANY_SLUG`). Stored as GitHub Action secrets `PROD_SMOKE_USER_EMAIL`, `PROD_SMOKE_USER_PASSWORD`. *Phase E.*
2. **Vercel deploy hook secret + Vercel API token**. Need a deploy-hook URL configured for production, plus a `VERCEL_TOKEN` with read+rollback scope on the project. Stored as GitHub Action secrets. *Phase E.*
3. **Notification channel**. Slack webhook URL or a designated email address for smoke-failure / config-drift notifications. *Phase E.*
4. **bundle.social management API access** (if available — check the dashboard). Drift detector needs to fetch the registered webhook URL from bundle.social to compare. If their API doesn't expose this, the drift check stays manual + checklisted in `docs/config-drift-coverage.md`. *Phase E.*
5. **Optional**: `SEMGREP_APP_TOKEN` for Semgrep Cloud (free tier OK). Without it Semgrep runs locally only — that's fine for *Phase D*; just slower CI feedback.

If any of (1)–(4) cannot be provisioned within the work window: the
relevant sub-system ships disabled with a `[ ]` checklist in
`docs/security-findings.md` and the ticket Steven gets is *one*
follow-up note rather than a per-phase escalation.

---

## 8. Highest-risk gaps — work order

Phase B targets #1. Phase C targets the cross-cutting helpers. Phase D
parallels (#3 + #5 + #6) along independent diff lines.

1. **bundle.social end-to-end coverage** at all seven layers. Phase B canary.
2. **Cross-tenant route sweep** (auth across companies). Phase C.
3. **Optimiser route layer**. Phase D.
4. **Visual regression baselines committed**. Phase D.
5. **Webhook signature audit** (qstash). Phase D.
6. **CAP / prompt-injection coverage**. Phase D.
7. **Skipped specs resolved** (`blog-styling-gate.spec.ts`). Phase D.
8. **Production smoke + drift detector + auto-hotfix**. Phase E.

The harness ships incremental commits on `chore/test-harness`.
Independently verified milestones may ship as separate commits in the
final PR. Layers 1, 4, 5 already partially exist — those commits add
to the existing surface. Layers 2, 6, 7 are net-new.
