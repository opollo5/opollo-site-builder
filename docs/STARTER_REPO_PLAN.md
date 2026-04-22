# Starter Repo Plan — `morey-saas-starter`

Target: a public GitHub template repo that bootstraps a new SaaS app with Next.js + Supabase + Vercel + Claude Code already wired. Clone it, rename a handful of things, and start shipping features on day one instead of spending week one on infrastructure.

This file is the spec. The actual `morey-saas-starter` repo doesn't exist yet; when it does, copy this file into it as `PLAN.md` until the structure stabilises.

---

## Guiding principles

- **Boring by default.** Every dependency and service pick is justified by a real production need. No experiments.
- **Escape hatches for every choice.** Don't lock anything in that can't be swapped. Logger transport, auth provider, hosting — each has one clean seam.
- **Three tiers.** Must-have lands in every clone; add-when-pain waits for a real symptom; defer-until-customers waits for revenue.
- **CLAUDE.md and ENGINEERING_STANDARDS.md pre-loaded.** A new project is AI-coder-ready on the first `npm install`.

---

## Tier 1 — Must-have (in the starter, on by default)

Everything here has earned its keep in the Opollo codebase and pays off in week one of any new project.

### Directory layout

```
morey-saas-starter/
├── .github/
│   ├── dependabot.yml              # weekly npm + actions refresh
│   └── workflows/
│       ├── ci.yml                  # typecheck / lint / build / test
│       ├── e2e.yml                 # Playwright + axe-core
│       ├── codeql.yml              # SAST
│       ├── gitleaks.yml            # secret scan
│       ├── audit.yml               # npm audit (critical-blocking)
│       ├── lighthouse.yml          # Core Web Vitals
│       └── release-please.yml      # changelog + version automation
├── .husky/
│   ├── pre-commit                  # lint-staged
│   └── commit-msg                  # commitlint
├── .claude/                        # Claude Code config (slash commands, etc.)
├── app/
│   ├── api/
│   │   ├── auth/                   # Supabase Auth callbacks
│   │   ├── emergency/              # break-glass endpoint
│   │   └── health/                 # /api/health liveness+readiness
│   ├── (marketing)/                # unauthenticated marketing routes
│   ├── admin/                      # authenticated admin routes
│   ├── login/
│   ├── logout/
│   └── layout.tsx
├── components/                     # shadcn/ui primitives + app components
├── lib/
│   ├── __tests__/                  # Vitest, hits local Supabase
│   ├── logger.ts                   # zero-dep JSON logger
│   ├── request-context.ts          # AsyncLocalStorage
│   ├── security-headers.ts         # CSP + strict headers
│   ├── supabase.ts                 # service-role + anon clients
│   ├── auth.ts                     # session helpers
│   ├── http.ts                     # API response envelope
│   └── prompts/                    # (when AI ships)
│       ├── v1/
│       └── __evals__/
├── e2e/
│   ├── fixtures.ts
│   ├── helpers.ts                  # signInAsAdmin, auditA11y
│   ├── global-setup.ts             # seeds test admin via Supabase admin API
│   ├── global-teardown.ts
│   ├── auth.spec.ts
│   └── admin.spec.ts               # sample spec; delete + replace
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   │   └── 0001_init.sql           # opollo_config + auth_role() + opollo_users
│   └── data-migrations/            # empty; shape documented
├── scripts/
│   └── sync-first-admin.ts         # promotes FIRST_ADMIN_EMAIL to admin role
├── docs/
│   ├── CLAUDE.md                   # project brief (pre-loaded with rules)
│   ├── ENGINEERING_STANDARDS.md    # this file's sibling; portable rules
│   ├── DATA_CONVENTIONS.md
│   ├── PROMPT_VERSIONING.md        # if AI is in scope
│   ├── RUNBOOK.md                  # pre-populated: deploy rollback, auth break-glass, key leak
│   └── BACKLOG.md                  # deferred items
├── middleware.ts                   # auth gate + security headers + request-id
├── next.config.mjs                 # bundle analyzer pre-wired
├── .env.local.example
├── .gitleaks.toml                  # allow-list with "why safe" comments
├── .lintstagedrc.json
├── .commitlintrc.cjs
├── .release-please-config.json
├── .release-please-manifest.json
├── lighthouserc.json
├── playwright.config.ts
├── vitest.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json                    # with all scripts + prepare: husky
└── README.md
```

### Scripts (package.json)

```
dev                    next dev
build                  next build
start                  next start
lint                   next lint
lint:css               stylelint 'seed/**/*.css'
typecheck              tsc --noEmit
test                   vitest run
test:watch             vitest
test:coverage          vitest run --coverage
test:e2e               playwright test
test:e2e:update        playwright test --update-snapshots
analyze                ANALYZE=true next build
prepare                husky
```

### Dependencies

**Runtime:**
- `next` (pinned to a patched release at clone time)
- `react` + `react-dom`
- `@supabase/supabase-js` + `@supabase/ssr`
- `zod` — boundary validation
- `@radix-ui/react-*` — only what shadcn/ui pulls in, no floating imports
- `class-variance-authority`, `clsx`, `tailwind-merge`, `tailwindcss-animate`

**Dev:**
- `typescript`, `@types/*`
- `vitest`, `@vitest/coverage-v8`, `@vitest/ui`
- `@playwright/test`, `@axe-core/playwright`
- `eslint`, `eslint-config-next`, `stylelint`
- `husky`, `lint-staged`
- `@commitlint/cli`, `@commitlint/config-conventional`
- `@next/bundle-analyzer`
- `tailwindcss`, `postcss`, `autoprefixer`
- `pg`, `@types/pg` — direct Postgres for test truncation
- `tsx` — run TypeScript scripts

### Env vars (.env.local.example)

Pre-populated with comments explaining which are required in dev vs. prod vs. CI:

```
# Supabase (required everywhere)
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# App encryption (generate with openssl rand -base64 32)
APP_MASTER_KEY=

# Auth (one of Basic or Supabase must be configured)
FEATURE_SUPABASE_AUTH=
BASIC_AUTH_USER=
BASIC_AUTH_PASSWORD=
FIRST_ADMIN_EMAIL=
EMERGENCY_KEY=

# Cron (if using Vercel cron)
CRON_SECRET=

# Optional observability (graceful no-op when unset)
SENTRY_DSN=
SENTRY_AUTH_TOKEN=
AXIOM_TOKEN=
AXIOM_DATASET=

# Optional AI (graceful no-op when unset)
ANTHROPIC_API_KEY=
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=

# Optional rate limiting (graceful no-op when unset)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

### Skeleton code

- `lib/logger.ts`, `lib/request-context.ts`, `lib/security-headers.ts` — **copied verbatim** from Opollo. They're already portable and have no product-specific dependencies.
- `middleware.ts` — Opollo's structure minus the Supabase-Auth-specific paths; feature-flag pattern preserved.
- `app/api/health/route.ts` — Opollo's structure, queries adjust per schema.
- `lib/http.ts` — response envelope + Zod boundary parsing.
- `e2e/helpers.ts` — `signInAsAdmin` / `auditA11y` scaffolding.
- First migration ships `config` (key/value), `users` (FK to `auth.users`), `auth_role()` helper, basic RLS scaffolding.

### CLAUDE.md pre-loaded

Ships with:
- "How to work" + self-test loop
- Sub-slice autonomy + auto-continue + auto-merge rules
- Self-audit + Risks identified and mitigated requirement
- Observability + security contract
- E2E coverage hard requirement
- Performance standards (Lighthouse + EXPLAIN ANALYZE)
- Data conventions pointer (to `docs/DATA_CONVENTIONS.md`)
- DX hygiene
- Release hygiene
- Runbook pointer

Blank stubs for the two project-specific sections: "What this is" (product description) and "Backlog" (project-local debt).

---

## Tier 2 — Add when pain (ship on demand, not in the starter)

Skip in the starter; add in the first PR where the missing piece blocks real work.

- **Sentry wiring.** Install + config scaffold, gated on `SENTRY_DSN`. Adds `sentry.client.config.ts` / `sentry.server.config.ts` / `sentry.edge.config.ts`. Source-map upload only when `SENTRY_AUTH_TOKEN` is set.
- **Axiom transport for `lib/logger.ts`.** One-file swap when an `AXIOM_TOKEN` exists. Fallback stays stdout.
- **Upstash Redis rate limiter.** Single `lib/rate-limit.ts` with a clean interface (in-memory shim for tests, Upstash for prod). Guarded on the two Upstash env vars.
- **Langfuse LLM observability.** Wraps Anthropic / OpenAI calls in a trace. No-op without the two Langfuse env vars.
- **Stripe billing.** Add when the first paying customer is imminent. Products + prices + webhooks + subscription table + dunning.
- **size-limit bundle budgets.** Add once a baseline is known; capture budget in `.size-limit.json`.
- **Synthetic monitoring (Checkly / Uptime).** When an SLA is in play.
- **Feature flags (Flagsmith / OpenFeature / LaunchDarkly).** Add when the first flag is actually needed.

Each item above lives in `docs/BACKLOG.md` in the starter so the "when to add" trigger is visible on day one.

---

## Tier 3 — Defer until customers

Everything here is valuable. None of it earns its keep until you're generating revenue or managing real user load.

- **Load testing** (k6 / Artillery). Nothing to load-test without traffic shape.
- **Chaos engineering**. Needs an SLA you care about.
- **Property-based / fuzz testing**. Valuable on hotspots; premature on a greenfield.
- **Component Storybook**. Design-system authoring tool; useful once a real design system exists.
- **Blue-green deploys**. Vercel's promotion flow covers the same ground for free until you outgrow Vercel.
- **CDN / image edge rules beyond Vercel defaults**. Defer.
- **Service-level distributed tracing** (OpenTelemetry collectors, Tempo/Jaeger). Single-region single-lambda apps don't benefit yet.

---

## Clone steps (for a new project)

1. Use "Use this template" on GitHub → create the new repo.
2. Rename the package in `package.json`.
3. Replace every `morey-saas-starter` / `Opollo` / `opollo` reference. Grep for them:
   - `package.json` name
   - `app/layout.tsx` title/description
   - `middleware.ts` `Basic realm="..."`
   - `.release-please-config.json` `package-name`
   - `docs/CLAUDE.md` "What this is"
4. Provision Supabase: `supabase init && supabase start`, run the baseline migration, capture the URL + service-role key.
5. Set env vars in Vercel: the required set from `.env.local.example`, skipping the optional transports until you need them.
6. Enable GitHub: Actions, Dependabot, CodeQL, branch protection (require `ci` + `e2e` green, auto-merge enabled).
7. First PR: replace the sample `admin.spec.ts` with a spec for your first real route. Delete the Opollo-shaped samples.

Day one shipping: a protected admin surface with auth, health checks, CI, CSP headers, request-ID propagation, structured logs, and an operator runbook. Nothing to set up. The next PR ships product features.

---

## What NOT to put in the starter

- Anything with a paid license at clone time (no Langfuse / Sentry / LogRocket defaults — they activate on env var presence).
- Anything with an unclear fork path (don't pin Next major; clone-time picks the latest patched release).
- Project-specific UX (no sample marketing pages, no hero section, no pricing table — those survive one clone before they start getting in the way).
- Opinionated state managers (Redux / Zustand / Jotai). Server Components + URL state cover 80% of cases; pull in a state manager when you hit the 20%.
- Opinionated form libraries. React Hook Form + Zod + Server Actions cover the starter's needs.

---

## Maintenance cadence

- Once a quarter: run each GitHub workflow against the starter itself, confirm green.
- After every successful Opollo-landing: audit whether the new bit belongs in the starter. If yes, back-port in a dedicated PR.
- Dependabot PRs auto-open; reviewer's job is to approve majors after verifying the starter still boots.
