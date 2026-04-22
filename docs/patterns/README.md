# Patterns

Playbook for recurring shapes in this codebase. Before starting any task that matches a pattern below, read the corresponding `.md` file first. Follow the files, tests, PR structure, and known pitfalls. If no pattern matches, proceed from first principles — and if the resulting work is likely to repeat, add a new pattern on the way out.

Each pattern file has the same shape:

- **When to use it** — the trigger; what question the pattern answers.
- **Required files** — paths + role.
- **Scaffolding** — copy-from references to existing, shipped examples.
- **Required tests** — minimum coverage.
- **Standard PR structure** — title, description sections, auto-merge.
- **Known pitfalls** — things past iterations got wrong.

## Index

### Shipping work

| Pattern | Used when |
| --- | --- |
| [`ship-sub-slice.md`](./ship-sub-slice.md) | Shipping a sub-slice of an approved parent milestone. |
| [`new-admin-page.md`](./new-admin-page.md) | Adding a new admin UI: list + detail + create / edit modals. |
| [`new-api-route.md`](./new-api-route.md) | Adding a new HTTP endpoint under `app/api/`. |
| [`new-migration.md`](./new-migration.md) | Schema change: `0NNN_*.sql` + rollback + tests + RLS. |
| [`extract-design-system.md`](./extract-design-system.md) | Onboarding a new client's design system into the structured registry. |
| [`feature-flagged-rollout.md`](./feature-flagged-rollout.md) | Shipping a behaviour change behind a reversible env flag + kill switch. |

### Workers + write safety

| Pattern | Used when |
| --- | --- |
| [`background-worker-with-write-safety.md`](./background-worker-with-write-safety.md) | Greenfield worker with lease / heartbeat / reaper / idempotency invariants. |
| [`new-batch-worker-stage.md`](./new-batch-worker-stage.md) | Adding a processing stage to the existing M3 batch worker. |
| [`quality-gate-runner.md`](./quality-gate-runner.md) | N independent pass/fail checks with first-fail short-circuit. |

### Testing

| Pattern | Used when |
| --- | --- |
| [`concurrency-test-harness.md`](./concurrency-test-harness.md) | N-worker race + idempotency + reaper assertions. |
| [`rls-policy-test-matrix.md`](./rls-policy-test-matrix.md) | (role × table × op) matrix for any RLS migration. |
| [`playwright-e2e-coverage.md`](./playwright-e2e-coverage.md) | Admin-UI E2E coverage per `CLAUDE.md`'s hard requirement. |

## Where else to look

- `docs/RUNBOOK.md` — operations playbook (deploy rollback, auth break-glass, batch stuck, key rotation, missing migration, general incident recovery).
- `docs/RULES.md` — one-paragraph rules born from specific incidents (shared test-helper discipline, fresh-stack auth config, CI-stuck-run recovery, write-safety audit requirement, UX-debt capture discipline).
- `docs/ENGINEERING_STANDARDS.md` — portable project-agnostic brief for future repos.
- `docs/BACKLOG.md` — explicitly deferred work with pickup triggers.
- `docs/DATA_CONVENTIONS.md` — soft-delete / audit columns / optimistic concurrency / data-migrations contract.
- `docs/PROMPT_VERSIONING.md` — `lib/prompts/vN/` layout + eval harness + prompt-injection defence + cost budgets.

## Maintenance

- Update a pattern on the PR that materially changes its shape. Don't let the pattern rot.
- If three unrelated PRs violate the same pattern, that's a signal the pattern drifted — rewrite.
- Don't add a pattern for shapes we've only done once. The bar is "done at least twice and likely to recur."
- If a pattern's "Known pitfalls" entry cites a PR that no longer applies (the root cause was fixed at a deeper layer, e.g. a schema constraint makes the pitfall impossible), mark it resolved in place rather than deleting — history of what we burned on stays useful.
