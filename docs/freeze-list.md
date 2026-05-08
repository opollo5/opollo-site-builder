# Freeze list — Build Proposal v2 (2026-05-08)

Changes in the categories below are **frozen** while the Phase 1 social composer workstream is active. No PR should touch these areas without Steven's explicit sign-off per the exception process.

## Frozen categories

| Category | Reason |
|---|---|
| Next.js version upgrade | Framework upgrade risk during active feature work |
| Tailwind 3 → 4 migration | Breaking API changes in a shared utility layer |
| React 18 → 19 migration | Concurrent mode behaviour changes could mask bugs in new hooks |
| Auth / session changes | Auth breaks are highest-severity incidents; defer outside active workstream |
| App directory restructuring | Any route reorganisation risks breaking the composer shell layout |
| Unrelated schema changes | New migrations not in the approved Week 0 plan risk migration ordering conflicts |
| Design system rewrites | UI-layer churn under active composer development |

## Frozen Dependabot PRs

The following Dependabot PRs must not be merged during the freeze:

- **#175** — (Dependabot patch/minor upgrade)
- **#177** — (Dependabot patch/minor upgrade)
- **#178** — (Dependabot patch/minor upgrade)

Dismiss the "Merge" button; do not click auto-merge on these PRs. They can be batched and merged in a dedicated chore PR once the freeze lifts.

## Exception process

To merge something in a frozen category:

1. Write a justification: what changed, why it must land now, not after the freeze.
2. Assess the risk: which code paths are affected, what could regress.
3. Write a rollback plan: how to revert if it breaks something.
4. Get Steven's explicit sign-off in a GitHub PR comment or Slack message.
5. Merge only after sign-off is on record.

## Freeze end condition

The freeze lifts when Phase 1 is merged to main and the social composer is in production behind `FEATURE_COMPOSER_ENABLED=true`. At that point this file should be removed or archived.
