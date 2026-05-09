# Performance standards

> Moved from `CLAUDE.md` 2026-05-09 as part of the harness restructure.
> Source: pre-restructure CLAUDE.md §"Performance standards".

- **Lighthouse CI:** every PR runs `.github/workflows/lighthouse.yml`
  against a production build of `/login` (session-gated admin surfaces
  are out of scope — they'd need the full Supabase-in-CI flow to render).
  Thresholds are `warn` for now; baseline ratchets to `error` once we
  have a few runs of stable history.
- **EXPLAIN ANALYZE for hot-path queries:** any new DB query in a code
  path that runs per-request or per-slot (chat route, batch worker,
  middleware, admin list pages) MUST be EXPLAIN ANALYZE'd against a
  realistic-volume seed before merge. Paste the plan in the PR
  description so the index decision is visible in history. Pointed-read
  queries keyed by PK/UUID skip this; new JOINs, LIKE / ILIKE, ORDER BY,
  and anything without an obvious index path do not.
