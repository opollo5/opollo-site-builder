# Opollo Site Builder

Next.js 14 (App Router) + TypeScript + Supabase + Vercel multi-product platform:

| Product | What it does |
|---|---|
| **Site Builder** | Chat-driven WordPress page generation via Claude (Anthropic SDK) |
| **Social Composer** | Multi-channel social post scheduling via bundle.social |
| **CAP** | Content Automation Platform — AI voice-matched LinkedIn content for MSP clients |
| **Optimiser** | Landing-page A/B testing + causal-delta optimisation |

## Local dev

```sh
cp .env.local.example .env.local
# fill in secrets
npm install
npm run dev          # http://localhost:3000
```

## Tests

```sh
npm run test:unit        # Layer 1+2 unit + regression (~10s, no Supabase)
npm run test:components  # Layer 4 component (jsdom, ~5s)
npm run test:integration # Layer 3 integration (real Supabase, ~10–40 min)
npm run test:e2e         # Layer 5 Playwright (real Supabase)
npm run test:security    # Layer 6 security assertions
npm run test:smoke       # Layer 7 live probe against deployed URL
```

Requires Docker + Supabase CLI for integration and e2e tests (`supabase start`).
Unit + component tests need no Docker.

## Smoke tests

Layer 7 probes for critical API surfaces. Require a live deployment and env vars — never run in CI automatically:

```sh
SMOKE_SESSION_COOKIE=... SMOKE_TEST_COMPANY_ID=... npm run smoke:composer
SMOKE_SESSION_COOKIE=... SMOKE_TEST_COMPANY_ID=... SMOKE_CAP_CAMPAIGN_ID=... npm run smoke:cap
```

See `scripts/smoke/README.md` for full env var reference. Budget cap: $5 cumulative (resets with `scripts/smoke/output/budget.json`).

## Key commands

```sh
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm run build          # Production build
npm run audit:static   # Static analysis (HIGH findings block CI)
npm run gen:types      # Regenerate Supabase types
```

## Architecture

See [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) for the full architectural overview.

Pointers to other docs: [`CLAUDE.md`](CLAUDE.md) → docs index.

## Staging

Set `APP_ENV=staging` in a Vercel branch environment to activate staging guards:
- All emails redirected to `STAGING_EMAIL_RECIPIENT`
- AI generation crons blocked by default (opt in with `STAGING_SIDE_EFFECTS_ENABLED=1`)

See [`docs/briefs/hardening-pass/STEVEN_ACTIONS.md`](docs/briefs/hardening-pass/STEVEN_ACTIONS.md) for setup steps.
