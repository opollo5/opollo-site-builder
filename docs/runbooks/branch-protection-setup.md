# Branch protection setup for `main`

One-time operator setup. Enables the CI workflow in `.github/workflows/ci.yml`
as a merge gate so no code reaches `main` without passing type-check, lint,
and the full Vitest suite.

## Steps

1. **GitHub → Settings → Branches → Add branch protection rule**
2. **Branch name pattern:** `main`
3. Tick the following, in this order:

### Require status checks to pass before merging
*Why:* the whole point. A PR can't merge until CI is green.

- Search-and-add each of the following check names (must match the `jobs.*`
  keys in `ci.yml`):
  - `typecheck`
  - `lint`
  - `test`

### Require branches to be up to date before merging
*Why:* forces a rebase-or-merge when `main` moves forward during review. Stops the "green on a stale tree that's broken against today's main" class of bug.

### Require conversation resolution before merging
*Why:* every review comment must be resolved (or explicitly dismissed) before the merge button activates. Low-cost guard against landing a change with an unanswered reviewer concern.

### Do not allow bypassing the above settings
*Why:* without this, admins can merge red PRs. The gate only works if it applies universally.

### Include administrators
*Why:* same as above but specifically for PATed automation/operators. If you trust the gate enough to enforce it, you trust it against yourself too.

### (Optional) Restrict who can push to matching branches
*Why:* prevents direct pushes to `main`, so every change has to go through a PR and therefore through CI. Recommended; tick if you have multiple operators.

---

## After saving

- Merge **PR #N** (the CI setup PR) using the GitHub merge button. This will
  be the first merge that exercises the gate.
- From that point on, every PR must show three green checks — `typecheck`,
  `lint`, `test` — before the merge button activates.
