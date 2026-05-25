# UAT Visual Regression Baselines

`e2e/uat/visual.spec.ts` uses Playwright's `toHaveScreenshot()` to detect visual regressions. Baselines live in `e2e/uat/__screenshots__/` and are platform-specific (Linux only — Playwright's snapshot path template appends `-linux` to disambiguate).

## When baselines are missing

A run with a missing baseline reports:

```
Error: A snapshot doesn't exist at e2e/uat/__screenshots__/visual.spec.ts/<name>-linux.png, writing actual.
```

This is *not* a test failure in the bug sense — it's the first-run snapshot capture. The spec failed because Playwright refuses to silently accept new baselines.

## How to regenerate (auto via CI)

The `uat-harness.yml` workflow has a regen trigger keyed off the commit message. If the last commit on `staging` (or `main`) contains the phrase `regen-baselines`, the workflow runs Playwright with `--update-snapshots` and auto-commits the new screenshots back to the branch as a `[skip ci]` commit.

Steps:

1. Open a PR against `staging` that touches anything under `e2e/uat/**` or `.github/workflows/uat-harness.yml` (so the workflow's path filter fires on push).
2. Make sure the **squash-merge commit subject** contains `regen-baselines` — e.g. `test(uat): regen-baselines for composer overlay`. GitHub uses the PR title for squash-merge commits by default; rename the PR before merging if needed.
3. Merge.
4. The `uat-full` job in the workflow detects the trigger, runs Playwright with `--update-snapshots`, and pushes a follow-up commit `chore(uat): update visual regression baselines [skip ci]` to staging.
5. Wait ~10 min for the workflow + auto-commit to complete; pull staging and confirm `e2e/uat/__screenshots__/visual.spec.ts/*.png` exist.

## How to regenerate (manual, when CI mechanism fails)

You need:
- `STAGING_UAT_SECRET` — bearer token (set in Vercel staging Preview env + GitHub Actions secret; manual capture requires extracting from Vercel Dashboard since `vercel env pull` masks sensitive values).
- `VERCEL_BYPASS_SECRET` — Vercel protection bypass token.

```bash
export STAGING_UAT_SECRET=<value>
export VERCEL_BYPASS_SECRET=<value>
export UAT_BASE_URL=https://opollo-site-builder-git-staging-opollo5.vercel.app

# Run Playwright with --update-snapshots against staging
npx playwright test e2e/uat/visual.spec.ts \
  --config playwright.uat.config.ts \
  --update-snapshots

# Stage and commit the new baselines
git add e2e/uat/__screenshots__/
git commit -m "test(uat): refresh visual baselines (manual)"
```

## When a baseline diff is expected (intentional UI change)

After a PR that intentionally changes a visually-regressed surface (e.g., calendar grid layout):

1. Add `regen-baselines` to the merge commit subject. The workflow refreshes baselines as part of the merge.
2. Inspect the diff in the follow-up `[skip ci]` commit — if the new screenshots show a broken UI, revert and fix the underlying change.
3. Never edit baseline PNGs by hand. Always regenerate from the live staging deployment.

## Baselines are platform-specific

`playwright.uat.config.ts` sets:

```ts
snapshotPathTemplate:
  "{testDir}/__screenshots__/{testFilePath}/{arg}-linux{ext}",
```

Baselines captured on macOS/Windows will not match the Linux CI runner. Always regenerate via CI, never from a local non-Linux machine.
