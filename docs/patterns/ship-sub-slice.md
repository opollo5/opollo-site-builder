# Pattern — Ship a sub-slice

## When to use it

Every PR that implements a sub-slice of an approved parent milestone (M2c-1, M3-7, infra-C, etc.). This is the meta-pattern — every other pattern file assumes you follow this one.

Don't use for: throwaway experiments, pure-docs PRs (those skip the risks audit but still follow the structure), or hotfixes (hotfixes have a different shape — PR first, plan later).

## Required files

Every sub-slice PR touches at minimum:

- Code under `lib/` / `app/` / `components/` implementing the slice.
- Tests covering the slice's happy path + the write-safety hotspots called out in the plan.
- `CLAUDE.md` entry if the slice creates a new convention, rule, or backlog pointer.
- PR description (see "Standard PR structure" below).

## Scaffolding

### Branch naming

`<type>/<kebab-scope>` — `feat/`, `fix/`, `chore/`, `refactor/`, `docs/`, `ci/`. Match the conventional-commit type you'll use in the title.

Examples:
- `feat/m3-6-wp-publish`
- `fix/login-server-action`
- `chore/scope-prefix-auto-generation`

### PR title

A conventional-commit subject. Squash-merge makes the PR title the commit message on main.

- `feat(m3-6): WP publish with pre-commit slug claim + adoption`
- `fix(admin/sites): server-render the list + revalidatePath on create`
- `feat(infra): security headers + observability skeleton + supply-chain scans`

Under 100 chars. Milestone scopes like `m3-6`, `m2c-2`, `infra`, `dx` fit inside the `scope` parentheses.

## Required tests

At minimum:

1. **Happy path** — one test per user-visible outcome.
2. **Every write-safety hotspot in the risks audit.** If the audit says "UNIQUE constraint on X prevents dup inserts," a test exercises the double-insert and asserts the second fails with the documented error code.
3. **Every error-code the slice introduces.** `NOT_FOUND`, `VALIDATION_FAILED`, `VERSION_CONFLICT`, `CANNOT_MODIFY_SELF`, etc. One test per code.
4. **E2E coverage** if the slice adds or substantially changes an admin-facing UI surface. See `CLAUDE.md` "E2E coverage is a hard requirement for admin UI changes."

## Standard PR structure

### Description

Every PR description contains these sections, in order:

```markdown
One-paragraph overview of what the slice does.

## What lands
- Bulleted list of the files added / changed + a one-line purpose each.

## Risks identified and mitigated
- **<hotspot>.** <how the plan mitigates it.>
- ...

## Deliberately deferred
- Items explicitly pushed to a later slice, with the reason.

## Self-test
- [x] `npm run lint` clean
- [x] `npm run typecheck` clean
- [x] `npm run build` clean
- [ ] `npm run test` — run in CI.
- [ ] `npm run test:e2e` — run in CI.
```

The **Risks identified and mitigated** section is non-optional. A plan without it isn't ready to execute. If the slice has no write-safety hotspots (pure docs, pure style), write "No write-safety hotspots — pure docs change" and move on. Don't skip the section.

### Flow

1. Open the PR with the full description + code + tests in one go.
2. Immediately arm auto-merge: `enable_pr_auto_merge(mergeMethod: "SQUASH")`.
3. Subscribe to PR activity so CI failures + review comments land in-session.
4. Monitor CI. On failure: read the auto-posted log comment, fix, push. Retry ceiling 10; same-failure-twice is the escalation trigger.
5. On merge, post a one-liner status: `"<slice> merged, starting <next>"`. Proceed to the next sub-slice without waiting.
6. Stop only when: (a) parent milestone fully completes, (b) architectural escalation, (c) same CI failure lands twice in a row.

## Known pitfalls

- **Forgetting to arm auto-merge.** Without `enable_pr_auto_merge`, the PR sits mergeable forever. Happened on PR #21 (M2c-2) and kicked off the explicit rule in `CLAUDE.md`. Arm it in the same message as `create_pull_request`.
- **Skipping the "Risks identified and mitigated" section.** Reviewers have caught slices missing idempotency keys, unique constraints, and `SAVEPOINT` pattern on unique-violation recovery because the section wasn't populated. No section → no execution.
- **Writing "wip: …" commit messages.** commitlint rejects these on the local hook; squash-merge uses the PR title so a wip on the branch is harmless, but the branch-local commit discipline matters if the PR ever needs rebase + force-push debugging.
- **Scope creep on a single sub-slice.** If the diff crosses 3000 lines, split. The reviewer-in-5-minutes rule is a check; if a PR can't be understood in five minutes of reading, it's too big.
- **Missing E2E spec on admin-facing UI.** Silent omissions are a review-blocker per `CLAUDE.md`. State in the description if something is intentionally unit-only ("purely a lib/ change," "admin-facing but flagged off").
- **Amending commits after a failed pre-commit hook.** The commit didn't happen, so `--amend` modifies the PREVIOUS commit. Always create a new commit instead.
- **Using `--no-verify`.** The hooks exist to catch real problems. A failing hook is a bug to fix, not a hook to skip. Exception: explicit operator approval.

## Pointers

- `CLAUDE.md` — "How to work," "Self-test loop," "Sub-slice autonomy," "Auto-continue between sub-slices," "Enabling auto-merge on every PR," "Self-audit is the review."
- `docs/ENGINEERING_STANDARDS.md` — portable version of the above for future projects.
