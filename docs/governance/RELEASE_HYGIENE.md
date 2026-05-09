# Release hygiene

> Moved from `CLAUDE.md` 2026-05-09 as part of the harness restructure.
> Source: pre-restructure CLAUDE.md §"Release hygiene".

- `.github/workflows/release-please.yml` watches main; every merge
  aggregates conventional commits into a Release PR that bumps
  `package.json` + generates `CHANGELOG.md`. Merging that PR cuts
  a GitHub Release + git tag.
- No external secrets — default `GITHUB_TOKEN` is enough.
- Commit discipline matters for the changelog: `feat:` → Features,
  `fix:` → Bug Fixes, `perf:` → Performance, etc. `chore:` / `test:`
  / `ci:` / `build:` are hidden from the user-facing changelog.
