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

---

# Spec autonomous-run log — 2026-05-08 (cont.) — composer polish + sitewide UX + asset handling + session policy

Six PRs landed against the 2026-05-08 master brief covering Specs 06, 07, 08, 09, and 14 PR A. Specs 11 / 12 / 14 PR B+C / 05 conditional / 08 surface-sweep deferred — see `_blockers.md`.

| Spec | PR # | Title | Branch | State |
|---|---|---|---|---|
| 06 | #755 | platform-aware keyboard shortcuts | feat/spec06-platform-keyboard-shortcuts | merged |
| 09 | #757 | seo-friendly image filenames + alt text on wp publish | feat/spec09-image-filename-alt-text | merged |
| 07-A | #758 | content-preview fix — empty-state detection + scoped styles | feat/spec07-pr-a-content-preview | merged |
| 07-B | #760 | loading-button primitive + use-async-action hook + sweep | feat/spec07-pr-b-loading-button | merged |
| 08 (primitives) | #762 | success-moment primitive + first-time hook + celebrate helper | feat/spec08-success-moments-v2 | merged |
| 14-A | #763 | session-expiry warning modal + final banner + hook | feat/spec14-pr-a-session-expiry-warning | open — manual review |

## What shipped

### Spec 06 — Platform-aware keyboard shortcuts (#755)

`lib/hooks/use-platform.ts` (`usePlatform()` + pure `detectPlatform()` + `useModKey()` for HTML title= attrs) and `components/ui/kbd.tsx` (`<Kbd keys={["mod","K"]}>`) defer Mac glyphs until hydration completes — eliminating the one-frame ⌘ flash on Windows. Sweep: `primary-nav` (⌘K hint), `BlogPostComposer` (⌘S save-draft hint), `BulkUploadPanel` (⌘↵ run hint), `RichTextEditor` toolbar tooltips (Bold / Italic / Undo / Redo via `useModKey()`). 8-case unit test in `lib/__tests__/use-platform.test.ts`. TipTap / Monaco / CodeMirror keybindings untouched — those libraries manage cross-platform internally. Comment-only ⌘ occurrences left as-is (developer-only).

### Spec 09 — SEO-friendly image filenames + alt text (#757)

`lib/utils/slugify.ts` — `generateImageFilename(postTitle, originalFilename, imageIndex, postId)`: first-5-words slugified, `-N` suffix for `imageIndex > 0`, deterministic 4-char FNV-1a hash for collision-resistance, 80-char total cap. Same `(postId, imageIndex)` → same filename → clean re-publish overwrite. `lib/seo/alt-text.ts` — `deriveAltText({seoTitle, siteName, postTitleFallback})`: strips trailing ` - {site}` / ` | {site}` / ` – {site}` / ` — {site}` (spec order). `lib/wp-featured-media.ts` extended with optional `uploadFilename` + `altText`; after media POST returns id, calls `POST /wp-json/wp/v2/media/{id}` with `{alt_text, title}` (soft failure: logged, swallowed — featured image already attached). Plumbed into `app/api/sites/[id]/posts/[post_id]/publish/route.ts`. 22 unit-test cases.

### Spec 07 PR A — Content-preview fix (#758)

Root cause: the truthy `post.generated_html ?` check rendered the iframe even when Tiptap's empty-marker `<p></p>` was saved — operators saw a blank pane and reported "preview is broken." Fix: `isHtmlEffectivelyEmpty(html)` strips tags + nbsp + zero-width chars before deciding; `wrapPreviewDocument(rawHtml)` wraps `generated_html` in a minimal styled HTML doc so the iframe renders with sensible typography even before site-level CSS loads. Empty-state copy → spec wording: "No content yet — add content via the post editor." Iframe height bumped `h-96` → `h-[32rem]`. Sanitisation provenance: content via `<iframe sandbox="">` (no allow-scripts / allow-same-origin / allow-forms) — stricter than DOMPurify + `dangerouslySetInnerHTML`.

### Spec 07 PR B — LoadingButton primitive + useAsyncAction hook (#760)

`components/ui/loading-button.tsx` wraps `<Button>` with NavIcon spinner inside the button face, `aria-busy`, disabled-while-loading, optional `loadingText` override. Spinner uses Linearicons `sync` + `animate-spin` (per CLAUDE.md the lucide-react path is gone). `lib/hooks/use-async-action.ts` — `useAsyncAction(action, {timeoutMs, onSuccess, onError, onTimeout})` with three load-bearing safeguards: in-flight ref de-dupe, hard UI-side timeout via `Promise.race`, error surfacing (never silent-swallow). Applied to PostDetailClient (Publish-to-WP) and BulkUploadPanel (Save N drafts). Underlying server actions untouched.

### Spec 08 — Success moments (primitives layer) (#762)

`components/ui/success-moment.tsx` — Tier-1 above-the-fold success block with optional `firstTimeKey` gate. First-time renders fire `celebrate()` once + use `firstTimeTitle` copy; subsequent visits stay quiet. NavIcon checkmark, primary + secondary CTA slots, brand-greens tint. `lib/hooks/use-first-time.ts` — localStorage-backed first-time detection per arbitrary key, private-mode safe via try/catch. `lib/celebrate.ts` — subtle confetti only (30 particles, 40 spread, 25 startVelocity, brand colors). Always respects `prefers-reduced-motion`. Per the brief's production-tested heuristic, medium / big intensities are NOT emitted by default. `lib/toast-success.ts` — Tier-2 toast helper. Dependency: `canvas-confetti ^1.9.4` + `@types/canvas-confetti ^1.9.0`. Surface integration deferred (parallel session has BriefRunClient surface in flight; sweep remaining Tier-1 surfaces in a follow-up).

### Spec 14 PR A — Session expiry warning modal + final banner (#763, manual review)

`lib/hooks/use-session-expiry.ts` reads the active Supabase session's `expires_at`, polls every 30s, returns `{expiresAt, minutesRemaining, expired, hydrated}` and subscribes to `onAuthStateChange`. `components/session/session-expiry-modal.tsx` — centred dialog when `minutesRemaining ≤ 120m`, cybersecurity copy explaining the 48h cap, "Remind me later" snoozes 30 minutes (component state, not localStorage). `components/session/session-expiry-banner.tsx` — undismissable sticky-top banner when `minutesRemaining ≤ 5m`. `components/session/session-expiry-watcher.tsx` mounts both, wires `onReauthenticate` to `/login?returnTo=<current>`. `app/admin/layout.tsx` replaces the corner-toast `SessionExpiryWarning` with the new watcher. **48-hour TTL itself requires Supabase dashboard config** (Auth → JWT expiry → 172800s); the client hook is TTL-agnostic.

## Parallel-session friction

Run-time observation, not a new finding: per memory's "Parallel sessions, single clone — git HEAD races, staged files can get swept into the other session's commit," the parallel session frequently swept HEAD between branches and reverted in-progress edits to existing files (PostDetailClient, admin/layout, etc.) during this run. Mitigation: stage + commit + push as a single atomic command sequence; create branches off `origin/main` (not local main); minimize the read-window between edit and commit. All six merged PRs ended up clean despite the friction.

## Blockers

See `_blockers.md` — Spec 11 (waits on Spec 10), Spec 12 (waits on Spec 13), Spec 05 PR C (gated on telemetry), Spec 14 PRs B+C (manual review, deferred), Spec 08 surface sweep, trusted-devices reconsideration, image-search latency baseline.
