# DX hygiene

> Moved from `CLAUDE.md` 2026-05-09 as part of the harness restructure.
> Source: pre-restructure CLAUDE.md §"DX hygiene".
>
> CLAUDE.md keeps a 4-line summary; this file is the canonical reference
> for hook content, supply-chain scanning, and conventional-commit rules.

Pre-commit and commit-message hygiene is enforced via Husky. Hooks
install on `npm install` via the `prepare` script.

## Pre-commit

Runs `lint-staged` + `npm run test:unit` (Vitest unit + contract +
regression + no-DB security suite, ~10 s).

- `lint-staged` runs ESLint (auto-fix) on staged JS/TS and stylelint on
  CSS. Any remaining warning fails the commit — `--max-warnings=0`.
- `npm run test:unit` catches contract-snapshot drift and regression
  breakage at commit time rather than CI time.
- Skip with `SKIP_PRECOMMIT_TESTS=1 git commit ...` for explicit
  rebases. **Never bypass with `--no-verify`** — see `CLAUDE.md`
  §"Pre-commit / commit-msg".

## commit-msg

`commitlint` enforces Conventional Commits (`feat` / `fix` / `chore` /
`refactor` / `docs` / `test` / `perf` / `build` / `ci` / `revert`).
Milestone scopes like `feat(m3-6):` or `feat(infra):` pass the default
rule set. Header length cap is 100 chars.

## Supply-chain scans (server-side)

- **CodeQL** (`.github/workflows/codeql.yml`) — SAST on every PR + weekly cron.
- **Dependabot** (`.github/dependabot.yml`) — weekly npm + actions refresh,
  Radix grouped, minors/patches grouped, majors separate.
- **gitleaks** (`.github/workflows/gitleaks.yml`) — secret scan with
  `.gitleaks.toml` allow-list for the deterministic test master key + local
  Supabase JWTs.
- **npm audit** (`.github/workflows/audit.yml`) — blocks on critical CVEs in
  prod deps, informational at high. Threshold will tighten to `high` once the
  pending Next.js framework upgrade lands.
