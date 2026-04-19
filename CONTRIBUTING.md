# Contributing

## Running tests locally

The test suite is integration-level: tests exercise the real data layer
against a running Supabase stack. Mocks are deliberately avoided — every
SQLSTATE behaviour (unique-violation, FK-violation, optimistic-lock
mismatch via PostgREST) is what we actually care about catching.

### Prerequisites

- **Docker** — required by the Supabase CLI to boot the local stack
  (Postgres, PostgREST, GoTrue, Studio, etc.)
- **Supabase CLI** — install via [the official instructions](https://supabase.com/docs/guides/local-development/cli/getting-started)
  or, on macOS, `brew install supabase/tap/supabase`
- **Node + npm** — the versions pinned in `.nvmrc` / `package.json`

### First-time setup

```bash
npm install
supabase start   # ~15–30s on first boot; applies all migrations automatically
```

`supabase start` reads `supabase/migrations/*.sql` and applies every file in
order against the local Postgres. When you add a new migration, run
`supabase db reset` to replay all migrations from scratch — the tests do not
reset migrations themselves.

### Running tests

```bash
npm test            # run once
npm run test:watch  # watch mode
```

Vitest's `globalSetup` calls `supabase status --output json` to find the
local API URL and service-role key. If the stack isn't running, it'll run
`supabase start` for you. Between tests, a `TRUNCATE ... CASCADE` clears
every M1 table via a direct Postgres connection on port 54322.

### Stopping the stack

```bash
supabase stop
```

Leaving it running between test runs is fine and recommended — `supabase
start` is slow, `supabase status` is instant.

### CI considerations (future)

GitHub Actions and similar runners need either Docker-in-Docker or the
Supabase CLI action (`supabase/setup-cli@v1` + `supabase start`). When we
wire up CI, the matrix job running `npm test` will:

1. Install Node + Supabase CLI
2. `supabase start`
3. `npm test`

This is not yet set up — track it under the M1 acceptance criteria for a
later slice. For now, tests are run locally by the operator.
