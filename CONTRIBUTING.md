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

### Linting

```bash
npm run lint        # next lint — TypeScript / JSX
npm run lint:css    # stylelint — enforces Layer-1 scope-prefix rule
                    # on all seed/*/*.css. Regex rejects malformed
                    # double-hyphen blocks deliberately (see the
                    # inner [a-z0-9]+ in seed/leadsource/.stylelintrc.json).
```

Both run in the single `lint` job in CI. A failing `lint:css` means one
or more class selectors in the seed CSS don't match the site's scope
prefix — either the class needs renaming (preferred) or it's legit and
should be added to the per-site `.stylelintrc.json` allowlist.

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

### CI workflow

The `.github/workflows/ci.yml` workflow runs on every pull request (from
same-repo branches) and every push to `main`. Three jobs:

- `typecheck` — `tsc --noEmit`
- `lint` — `npm run lint`
- `test` — `supabase start` → `npm test` → `supabase stop`

See `docs/branch-protection-setup.md` for the one-time operator setup that
makes these three jobs a hard gate on merging to `main`.

### Instructions for Claude Code: CI self-test loop

**When Claude Code opens a PR, it must watch CI and self-heal failures
before notifying the operator.**

1. Push the branch, open the PR.
2. Poll CI status via the `mcp__github__pull_request_read` tool with
   `method: "get_check_runs"` every ~30–60s, or subscribe to PR activity
   via `mcp__github__subscribe_pr_activity`. Wait for all three jobs to
   reach a terminal `conclusion` (`success` / `failure` / `cancelled` /
   `timed_out`).
3. If any job concludes failure:
   a. Fetch the failing job's log output. The `mcp__github__pull_request_read`
      tool's `get_check_runs` method returns check-run metadata; to read
      actual log lines you'll need to follow the `details_url` or use
      whatever log-reader MCP tool is available in-session (search via
      `ToolSearch` if needed).
   b. Diagnose the root cause. Fix on the same branch. Do **not** skip the
      failing step with `continue-on-error` or comment it out — fix the
      underlying issue.
   c. Commit + push the fix. Re-enter step 2.
4. Cap at **three fix attempts** per PR. After three red runs on a normal
   PR, stop and ask the operator to review the logs. The exception is
   CI-plumbing work itself (initial workflow setup, Supabase CLI version
   bumps, Docker layer issues) — those are legitimately finicky on first
   run and get up to five attempts.
5. Only ping the operator "ready for review" when all three jobs are green.

Rationale: operators shouldn't have to chase CI failures that Claude Code
could resolve in one iteration. The cap exists so Claude Code doesn't thrash
on a genuinely hard problem.
