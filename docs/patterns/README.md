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

| Pattern | Used when |
| --- | --- |
| [`ship-sub-slice.md`](./ship-sub-slice.md) | Shipping a sub-slice of an approved parent milestone. |
| [`new-admin-page.md`](./new-admin-page.md) | Adding a new admin UI: list + detail + create / edit modals. |
| [`new-api-route.md`](./new-api-route.md) | Adding a new HTTP endpoint under `app/api/`. |
| [`new-migration.md`](./new-migration.md) | Schema change: `0NNN_*.sql` + rollback + tests + RLS. |
| [`extract-design-system.md`](./extract-design-system.md) | Onboarding a new client's design system into the structured registry. |
| [`new-batch-worker-stage.md`](./new-batch-worker-stage.md) | Adding a processing stage (Anthropic / gates / WP) to the M3 worker. |

## Maintenance

- Update a pattern on the PR that materially changes its shape. Don't let the pattern rot.
- If three unrelated PRs violate the same pattern, that's a signal the pattern drifted — rewrite.
- Don't add a pattern for shapes we've only done once. The bar is "done at least twice and likely to recur."
