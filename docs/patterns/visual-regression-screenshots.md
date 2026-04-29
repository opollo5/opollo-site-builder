# Visual regression screenshots — workflow

How to capture, commit, and reference before/after screenshots in
polish-pass PRs. Hard rule per the polish workstream brief — every
Phase B per-screen PR must include them in the description.

## What it is

A Playwright spec at `e2e/screenshots.spec.ts` that loops through every
admin route, takes deterministic screenshots at two viewports, and
writes them to `playwright-screenshots/<viewport>/<route-slug>.png`.

- **Desktop:** 1440×900 (Linear / Vercel reference width)
- **Mobile:**  380×844 (iPhone-class width floor)
- **Per-route:** `networkidle` wait + reduced-motion + UTC clock + en-US
  locale → no clock tick or animation flicker between runs.
- **Element masking:** any DOM node with `data-screenshot-mask` is
  greyed out at snapshot time. Use this on relative-time strings
  ("updated 3 minutes ago") so a clock tick doesn't churn the diff.

## When to run

- **Once at workstream baseline** (A-0) — captures every screen pre-polish.
- **At the end of every Phase B per-screen PR** — overwrites the screenshots
  for the surfaces the PR touches. The diff in the PR's Files Changed view
  IS the before/after comparison (GitHub's image-diff side-by-side renders
  PNGs natively).

## How to run

### In CI (canonical path)

`.github/workflows/screenshots.yml` runs on every PR + push to main +
on-demand `workflow_dispatch`. Each run uploads
`playwright-screenshots/` as an artifact named
`playwright-screenshots-<pr-number-or-sha>`. Reviewers download from
the run's "Artifacts" panel, expand the zip, and review the PNGs in
their image viewer of choice.

The PR description should link to the relevant run + name the
affected files. Example:

```markdown
## Screenshots

[Latest screenshot CI run](https://github.com/opollo5/opollo-site-builder/actions/runs/12345)

Surfaces this PR materially changed:
- `desktop/admin-sites-list.png`
- `mobile/admin-sites-list.png`
```

### Locally (when you need to iterate without pushing)

```bash
# 1. Local Supabase running (the harness queries the seeded test site).
supabase start

# 2. Capture every admin surface at both viewports.
npm run screenshots
```

The script signs in as the seeded `playwright-admin@opollo.test` user
(see `e2e/global-setup.ts`), navigates to each route in `e2e/screenshots.spec.ts::ROUTES`,
and writes PNGs.

Skipped by default in regular CI — `npm run test:e2e` passes a `RUN_SCREENSHOTS=1`
env-var guard that's only set by the dedicated `npm run screenshots` script
(via the workflow above).

## How to reference in a PR description

Each PR opens with a **"Screenshots"** section listing every changed
file by path. Reviewers click through to GitHub's Files Changed view
which renders side-by-side image diffs.

Template:

```markdown
## Screenshots

Before / after at desktop + mobile (per the polish workstream hard rule):

- `playwright-screenshots/desktop/admin-sites-list.png`
- `playwright-screenshots/mobile/admin-sites-list.png`
- `playwright-screenshots/desktop/admin-site-detail.png`
- `playwright-screenshots/mobile/admin-site-detail.png`
```

GitHub's PR diff for binary PNGs has a "Source diff / Side by side /
Onion skin" toggle — "Side by side" is the canonical review view.

## Adding a new route to the harness

Edit the `ROUTES` array in `e2e/screenshots.spec.ts`:

```ts
{
  slug: "admin-sites-detail-pages",      // becomes the filename
  url: "/admin/sites/{siteId}/pages",   // {siteId} = seeded test site
  // optional: waitForSelector, hydrationDelayMs
},
```

`{siteId}` interpolates to the seeded E2E test site's UUID — that's
the only dynamic-route surface the harness handles today. Routes with
deeper dynamic segments ([brief_id], [post_id], [page_id]) capture the
list-or-redirect surface above them; if a per-screen PR needs a deeper
detail screenshot, seed the prerequisite data in a `test.beforeAll`
inside that PR's spec rather than expanding the harness.

## Determinism requirements

If you add a new route that produces a non-deterministic screenshot
(animations, relative timestamps, randomised IDs visible in the DOM),
fix it before merging the harness change:

1. **Relative timestamps** — wrap with `<span data-screenshot-mask>...`
   so the harness greys them out.
2. **Animations** — none should run; the harness sets
   `reducedMotion: "reduce"` browser-context-wide. If a component
   bypasses `prefers-reduced-motion` (a polish-pass bug), fix the
   component instead of the harness.
3. **Random IDs** — these shouldn't render in operator-facing UI in the
   first place. If they do, hide them behind `data-screenshot-mask`
   or remove them from the surface.

## What "diff is too noisy" means

If a Phase B PR's screenshot diff shows changes you didn't make
(re-flowed badges, shifted icons), the cause is usually one of:

- A foundation primitive consumed by this surface changed in a recently-
  merged Phase A PR — the visual change is intentional.
- A relative timestamp wasn't masked — wrap with `data-screenshot-mask`.
- The seeded test data drifted (e.g. a new batch was inserted) — re-run
  `supabase db reset` and `npm run screenshots`.

Don't paper over noisy diffs by skipping the surface; investigate.
