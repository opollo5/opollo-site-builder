# Opollo Site Builder

Next.js 14 app for generating WordPress pages via the WP REST API, driven by Claude.

Day 1 scope: single-tenant (LeadSource only), streaming chat, `create_page` tool.

## Local dev

```
cp .env.local.example .env.local
# fill in secrets
npm install
npm run dev
```

## Tests

See `CONTRIBUTING.md` for the full setup. TL;DR: `supabase start && npm test`,
which requires Docker and the Supabase CLI installed locally.

> **Status (as of M1b):** the Vitest suite for the M1 data layer has been
> written and type-checked, and the `0003_m1b_rpcs.sql` RPC has been
> verified against scratch Postgres via psql. The full `npm test` run has
> NOT yet been executed end-to-end against `supabase start` because M1
> development happened in a sandbox without a Docker daemon. Run it
> locally before M3 (batch generator) starts — that's where data-layer
> regressions actually bite.

