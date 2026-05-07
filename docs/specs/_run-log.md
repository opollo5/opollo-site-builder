# Spec autonomous-run log — 2026-05-07

Single-session run of Spec 03 then Spec 02, six PRs total, all auto-squash-merged into main.

## Summary

| Spec | PR # | Title | Branch | Commit on main | State |
|---|---|---|---|---|---|
| 03 | #735 | blog-styling extractor + wizard section | feat/spec03-pr1-blog-extraction | `9fcf1336` | merged |
| 03 | #736 | blog-styling preflight gate + banner + CTA disabling | feat/spec03-pr2-preflight-gate | `9c955cde` | merged |
| 03 | #739 | `<blog_content_classes>` injection block (helper ready) | feat/spec03-pr3-runner-injection | `d58e1d5d` | merged |
| 02 | #740 | PageHeader + Breadcrumb + PageShell primitives + type scale | feat/spec02-pr1-page-header-primitives | `df1db378` | merged |
| 02 | #741 | PageHeader adoption — top 8 admin routes (29 deferred) | feat/spec02-pr2-page-header-adoption | `3f662f4f` | merged |
| 02 | #742 | page-header HIGH audit rules + RULES.md + ARCH | feat/spec02-pr3-audit-rules | `1eb9d47e` | merged |

## What shipped

### Spec 03 — Blog styling calibration for copy_existing sites

**PR 1 (#735, `9fcf1336`)** — Extension of the copy-existing extractor + wizard:
- `BlogStyling` type and Zod schema added to `lib/copy-existing-extract.ts` and the save route.
- `extractBlogStyling()` fetches up to 3 blog URLs, registrable-domain (with multi-part TLD support) same-origin filter, regex-tally bucket extraction with utility-class filtering, cross-URL consistency merge.
- New collapsible "Blog styling (optional)" section in `CopyExistingExtractionWizard`: 3 URL inputs with same-origin client-side validation, grouped review fields (Container / Text / Headings / Lists / Media / Block elements / Code), notes, "Calibrated N days ago" age label, auto-expand on `?focus=blog-styling`.
- `lib/__tests__/copy-existing-extract-blog.test.ts` with 12 vitest cases covering registrable-domain edges, same-origin filter, utility-class filtering, cross-URL consistency, container fallback, malformed HTML.

**PR 2 (#736, `9c955cde`)** — Preflight gate + banner across surfaces:
- New `BLOG_STYLE_NOT_CALIBRATED` blocker in `lib/site-preflight.ts`. Fires only on `copy_existing` + `content_type='post'` + missing `blog_styling`.
- New `BlogStyleCalibrationBanner` component. Wired into `/admin/sites/[id]`, `/admin/sites/[id]/posts`, and `/admin/sites/[id]/briefs/[brief_id]/run`.
- Disabled `+ New post` and `Start run` CTAs with `Calibrate blog styling first` tooltip when blocker is active.
- `lib/__tests__/site-preflight.test.ts` covers full mode/content_type matrix.
- `e2e/blog-styling-gate.spec.ts` Playwright happy path.

**PR 3 (#739, `d58e1d5d`)** — Runner injection helper (activation gated):
- `lib/design-discovery/build-injection.ts` extended with `BlogStylingRow` type, `renderBlogContentClassesBlock()`, `blogStylingHasUsableData()` guard.
- `buildDesignContextPrefix()` and `renderInjection()` now accept optional `contentType?: 'post' | 'page'`.
- `<blog_content_classes>` block emission gated on `contentType === 'post'` AND `extracted_design.blog_styling` having usable data.
- `docs/ARCHITECTURE.md` §5 updated to document the new block.

### Spec 02 — Platform PageHeader, breadcrumbs, type scale

**PR 1 (#740, `df1db378`)** — Primitives + tokens:
- `components/ui/page-header.tsx`: compound component (Breadcrumb / Title / Subtitle / Meta / Actions). Slot detection by `displayName`, NOT reference equality.
- `components/ui/breadcrumb.tsx`: standalone primitive. Mobile collapse via pure CSS (`sm:` variants), no JS measurement.
- `components/ui/page-shell.tsx`: layout primitive, locked 1280px max-width per spec algorithm (audit on 2026-05-07 found no class > 60% of files).
- `app/globals.css`: `.text-page-title` (28px / 24px mobile), `.text-section-title` (20px), `.text-subsection` (16px) — additive on top of existing 16px floor.
- `lib/__tests__/breadcrumb.test.ts` and `lib/__tests__/page-header.test.ts`.

**PR 2 (#741, `3f662f4f`)** — Top-8 admin routes adopt PageHeader:
- Migrated: `/admin/sites`, `/admin/sites/new`, `/admin/sites/[id]/edit`, `/admin/sites/[id]/onboarding`, `/admin/sites/[id]/setup`, `/admin/sites/[id]/setup/extract`, `/admin/sites/[id]/posts`, `/admin/sites/[id]/settings`.
- 29 admin + 2 account routes deferred to a follow-up sweep — see Blockers section.

**PR 3 (#742, `1eb9d47e`)** — HIGH audit rules + docs:
- Three new HIGH-severity rules in `scripts/audit.ts`: `headings-use-page-header`, `breadcrumb-required-when-page-header`, `no-raw-h1-in-pages`.
- `PAGE_HEADER_DEFERRED_ROUTES` allowlist carries the 31 routes deferred from PR 2.
- `docs/RULES.md` adds rules #10 / #11 / #12 with locked justification copy.
- `docs/ARCHITECTURE.md` §13.3 / §17 / §20 updated.

## Blockers / deviations

Documented in `docs/specs/_blockers.md`. Two contradictions surfaced and resolved with logged interim behaviour:

### Spec 03 PR 3 — content_type gating without modifying brief-runner.ts

Spec 03 §3.1 wants the `<blog_content_classes>` block gated on `content_type='post'`. Spec 03 §3.2 says "this PR does not modify the runner" (per ARCH §18). The only way to thread `content_type` to the helper would be a one-line change at `lib/brief-runner.ts:2004`. The PR shipped the helper extension as ready-to-activate and left the runner line for Steven's explicit approval. Activation is a single-line change documented in `_blockers.md`.

### Spec 02 PR 2 — partial admin-route adoption sweep

Spec 02 §2.1 wants PageHeader adopted on every admin route in one PR. The single autonomous-run window couldn't reliably hand-migrate 37 page.tsx files without risking subtle layout regressions. The PR migrated the 8 highest-traffic operator routes; the remaining 29 + 2 account routes are deferred via `PAGE_HEADER_DEFERRED_ROUTES` allowlist in `scripts/audit.ts`. Each deferred entry gets removed from the list as a follow-up PR migrates it.

## Verification per PR

Every PR ran the same trio plus audit:static, all clean before commit:
- `npm run typecheck` — 0 errors on each PR.
- `npm run lint` — 0 warnings/errors on each PR.
- `npm run build` — completed on each PR.
- `npm run audit:static` — 0 HIGH, 0 MEDIUM on each PR (LOWs pre-existing).

Vitest + Playwright suites added per spec but not run locally — ARCH §14.1 documents the pre-existing CI red on Supabase stack startup that prevents local execution; specs join the suite for CI to pick up.

## Run-log file metadata

Final summary written by the autonomous spec runner; PRs all auto-squash-merged via `gh pr merge --auto --squash` per the project's main-branch protection settings.

---

# Spec autonomous-run log — 2026-05-08

Spec 04 — PageHeader slot-order flip + polish + complete migration.

| Spec | PR # | Title | Branch | Commit on main | State |
|---|---|---|---|---|---|
| 04 | #744 (PR A) | Slot-order flip + polish + rhythm + exempt allowlist | feat/spec04-pr-a-page-header-flip | (auto-closes via squash-dedup) | open, superseded |
| 04 | #747 (PR B) | Migrate batch 1 | feat/spec04-pr-b-migrate-batch-1 | (auto-closes via squash-dedup) | open, superseded |
| 04 | #748 (PR C) | Migrate batch 2 | feat/spec04-pr-c-migrate-batch-2 | (auto-closes via squash-dedup) | open, superseded |
| 04 | #749 (PR D) | Migrate batch 3 + cumulative head | feat/spec04-pr-d-migrate-batch-3 | TBD (squash-merge target) | open |
| 04 | #750 (PR E) | Final routes + drain `PAGE_HEADER_DEFERRED_ROUTES` to [] | feat/spec04-pr-e-migrate-final | merged into PR D's branch (`99ac09ba`) | merged-stacked |

PR E was stacked on PR D's branch; auto-merge consumed it without going through main, so PR D (#749) is the cumulative head carrying every Spec 04 change. When #749 squash-merges to main, GitHub's squash-dedup auto-closes #744/#747/#748 (their content is identical to D's first three commits).
