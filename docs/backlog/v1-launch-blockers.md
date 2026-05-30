# v1 launch blockers — live items

> Things that MUST be resolved before any client gets v1. Shipped items
> are deleted, not struck-through — ship-state lives in git log.

## E2E test suite — restore as required check

**Status:** flaky, removed from required status checks during #1164.
**Owner:** unassigned.
**Source:** Steven, 2026-05-30 (post-PR #1166).

Steven flagged this on 2026-05-30 after PR #1166 fixed a single
time-bomb in `dashboard.spec.ts` ((F-1) calendar grid). The wider
e2e suite has been systemically flaky, and #1164 removed it from
main's required status checks so flake doesn't block routine merges.
That's an acceptable short-term workaround but cannot persist into
v1 — without e2e gating, regressions land silently.

### Checklist (must all be complete before any client gets v1)

- [ ] **Diagnose root cause of e2e flakiness.** Likely candidates:
  - Timing (more `Date.now() + N` style time-bombs like #1166 fixed)
  - Seed data drift between runs against shared staging Supabase
  - Auth-fixture cookie / session-token expiry across runs
  - Playwright concurrency / shared-state issues
  - Non-deterministic third-party calls in test paths
- [ ] **Fix or `test.fixme()` every inherently-flaky test.** Each
  `test.fixme()` must link an open issue (per CLAUDE.md §"Seven-layer
  test harness — Flaky / fixme tests": seven-day SLA on linked
  issue or CI fails).
- [ ] **Restore `e2e` as a required check** in main's branch
  protection (Settings → Branches → main → Required status checks).
- [ ] **Verify 3 consecutive PRs pass `e2e` cleanly** with the
  restored required check, before declaring stable.

### Why this is launch-critical

E2E covers the customer-facing journeys (composer, calendar,
approval, analytics modal, design discovery, …). Without it as a
required check, a regression in any of those surfaces can ship to
production without CI catching it. Pre-launch the operator sees
nothing because there are no clients. Post-launch the first client
becomes the canary.

### References

- PR #1164 — removed `e2e` from required checks
- PR #1166 — fixed the `(F-1)` calendar-grid time-bomb (one
  documented instance of the wider flake class)
- `docs/recon/DEDUP_OR_PERSIST_AUDIT.md` — adjacent audit;
  shape #7 (rate-limit atomic increment) and shape #4/#5 (cost-cap
  + cron `recordHealthEvent` collisions) all interact with the
  test-determinism problem
- CLAUDE.md §"Decision policy" principle 3 — extended in PR #1167
  to forbid `Date.now() + N` style offsets in tests whose
  assertions depend on landing in a visible range
