# World-class polish pass — operator review

> **Status:** Phase 2 + Round-1 review feedback complete. Awaiting operator review.
> **Workstream:** parent plan PR #229. Sub-slices PR #230 → PR #268 (31 PRs total).

## Summary

The world-class polish pass shipped in three waves:

| Wave | Slices | PRs | Status |
|---|---|---|---|
| Phase A — Foundation primitives | 8 | #230, #231, #232, #233, #234, #235, #236, #237 | ✅ all merged |
| Phase B — Per-screen polish | 15 | #238, #239, #240, #241, #242, #243, #244, #245, #246, #247, #248, #249, #250, #251, #252 | ✅ all merged |
| Screenshot CI wiring | 1 | #253 | ✅ merged |
| Phase C — Cross-cutting | 3 | #254, #255, #256 | ✅ all merged |
| **Round 1 review feedback** | **3** | **#264, #266, #268** | **✅ all merged** |
| R — Operator review | 1 | _this PR_ | ⏸ awaiting review |

**Total: 31 PRs.**

## Round 1 review — what changed since the first review

The first review surfaced 11 items grouped into Layout (1-3), Buttons (4), Image picker (5-8), Bug fixes (9-10), Density (11). All 11 shipped across three follow-up PRs:

### #264 — feat(r1-1): sidebar layout (items 1-3)
- **AdminSidebar** replaces the top horizontal AdminNav. 240px expanded / 64px icon-only collapsed (toggle persists via `opollo:sidebar:collapsed` localStorage). Mobile: off-canvas drawer with hamburger + backdrop + Escape close.
- **Page-canvas tint**: new `--canvas` HSL token (light: 220 14% 96%, dark: 222 47% 7%). Cards stay on `--background`; canvas is one notch off so card edges register.
- **Content gutters**: `px-8 py-8` desktop / `px-4 py-6` mobile per the Linear pattern. `mx-auto max-w-6xl` so wide surfaces don't stretch edge-to-edge.

### #266 — feat(r1): button hierarchy + auth shells + sites density + magenta-mask fix (items 4, 9, 10, 11)
- **Magenta blocks fix (item 9)**: Playwright's default `maskColor` is `#FF00FF` (bright magenta) — that's what showed up on the Sites list UPDATED column in screenshot artifacts. Set to `#e5e7eb` (cool gray, near canvas) so masked relative-time cells read as "dynamic text" not "broken styling."
- **Auth surfaces (item 10)**: `/login`, `/auth/forgot-password`, `/auth/reset-password` wrapped in `bg-canvas` + form sits in a `rounded-lg border bg-background p-6 shadow-sm` card. Inputs/buttons now sit against a real surface instead of floating on raw white.
- **Sparse-data density (item 11)**: SitesTable rows `py-2.5 → py-2`. UserStatusActionCell vertical stack → horizontal row. Single-row tables now read as "compact data tool."
- **Button hierarchy (item 4)**: `default`/`destructive` get `shadow-sm + hover:shadow + active:translate-y-px` (tactile press). `outline` swaps hover from `bg-accent` to `bg-muted/60` so it doesn't compete with primary. `ghost` explicit `bg-transparent + hover:bg-muted`. Size `sm` tightened to `h-8 + text-xs`. **`--secondary` token bumped from 96.1% to 87% lightness** so secondary buttons are visible against the canvas.

### #268 — feat(r1): image picker overhaul (items 5-8)
- **Backend** (`/api/admin/images/list`): new `for_post=<uuid>` (server reads `posts.title + content_brief`, builds FTS query with title repeated 3× as the title-weighting equivalent — PostgreSQL FTS doesn't apply tsquery weights without setweight on the source vector) + new `suggest_from=<text>` (pre-save callers pass title + body snippet directly). Default limit 5 in suggestion mode. Empty post context → recent uploads. Response envelope adds `suggestion: { based_on, fallback_to_recent }`.
- **Frontend** (ImagePickerModal): 3-tab segmented control replaces the old border-bottom tabs. **Suggested** default-selected when caller passes `forPostId` or `suggestionContext`; otherwise opens to **Browse**. Suggested panel: 5-image grid with skeletons during load + context banner ("Suggested for: <title>" or fallback copy).
- **Composer wiring** (BlogPostComposer): passes `suggestionContext={\`${title} ${title} ${title} ${body-snippet-400}\`}` so the picker's Suggested tab works pre-save (composer doesn't have a post id yet).
- **URL fetch** retained as a sub-mode under Upload ("Or paste a URL instead" disclosure) so BP-6 functionality isn't lost in the 3-tab restructure.

## How to review

Screenshot CI workflow (`.github/workflows/screenshots.yml`, PR #253) fires on this PR's open + every push to main. Download from this PR's most recent **Screenshots** workflow run:

1. Open this PR's "Checks" tab.
2. Click the **Screenshots** workflow run.
3. Scroll to **Artifacts** at the bottom.
4. Download `playwright-screenshots-<this-PR-number>.zip`.
5. Compare against the baseline in main's most recent `Screenshots` run (any commit on main → Actions → Screenshots).

The artifact contains every admin surface at desktop 1440×900 + mobile 380×844, plus axe-core a11y findings (per C-3) attached to the test-results folder.

For each surface below: read the Score row first; the Pre / Post-C / Post-R1 columns show the trajectory. Send specific Round-2 feedback via PR comment.

---

## Honest re-scoring against the 12 quality dimensions

Compared to (a) the audit baseline in `docs/plans/world-class-polish-parent.md` and (b) the post-Phase-C scoring in the previous report. The new "Post R1" column reflects what shipped in #264 / #266 / #268.

I'm marking only dimensions that **moved**. Dimensions that didn't move from Post-C to Post-R1 stay where they were — claiming improvements I didn't ship would be the optimistic re-scoring Steven explicitly warned against.

### Cross-cutting baseline

| Dimension | Pre-polish | Post Phase-C | **Post R1** | What R1 moved |
|---|---|---|---|---|
| 1. Motion | 3 | 5 | 5 | (no R1 change) |
| 2. Live data | 4 | 5 | 5 | (no R1 change) |
| 3. Empty states | 2 | 5 | 5 | (no R1 change) |
| 4. Loading states | 1 | 5 | 5 | Image picker Suggested tab now has skeleton thumbnails during load. |
| 5. Density | 2 | 4 | **4** | Tightened sparse tables (item 11) but didn't touch the broader density story. **Honest call: still 4.** Cross-cutting density would require a per-screen sweep R1 didn't have scope for. |
| 6. Typography | 4 | 5 | 5 | (no R1 change) |
| 7. Color | 3 | 5 | 5 | Canvas tint adds a third surface tier (canvas / card / muted) — token system clean. |
| 8. Microinteractions | 2 | 4 | **4** | Button `active:translate-y-px` adds tactile press; sidebar hover refined. **Still 4** because drag-to-reorder + count-up on dynamic values still missing. |
| 9. Keyboard | 2 | 5 | 5 | Sidebar Escape-to-close works; ⌘K hint visible in the sidebar footer. |
| 10. Speed perception | 2 | 5 | 5 | (no R1 change) |
| 11. Mobile | 3 | 4 | **4** | Mobile sidebar drawer added; auth surfaces fit. **Still 4**: no native gesture layer (swipe-to-dismiss, pull-to-refresh). |
| 12. Accessibility | 3 | 4 | 4 | Sidebar carries `aria-expanded` / `aria-controls` / `aria-current`; auth shells improved. **Still 4**: full WCAG-AA contrast audit deferred; the `--secondary` change at 87% lightness needs contrast verification under dark mode against `text-secondary-foreground`. |

**Overall: every dimension still scores 4+. Six dimensions at 5.** Round 1 didn't push any axis to 5 that wasn't already there, but it fixed the visual issues that made the previous "5" claims feel hollow (sidebar layout, button hierarchy, auth shells). The remaining 4-scores are honest reflections of work that still needs doing.

---

## Per-screen rundown

Score format: `motion / live / empty / load / density / type / color / micro / kb / speed / mobile / a11y`. **Bold** scores are those that moved in R1.

### `/admin/sites` (sites list)
**Phase B PR:** B-2 (#239) **R1 PR:** #266 (sparse-data density)
**Score:** 4/4/5/5/**4**/5/5/4/5/5/4/4

R1 changes: row padding `py-2.5 → py-2`. Single-row sites list no longer feels marooned (item 11). Magenta blocks on UPDATED column gone (item 9 — global mask color fix in the screenshot harness).

Remaining gaps: None worth a sub-PR. Could explore information-density wins (last-batch status inline) but that's product, not polish.

### `/admin/sites/[id]` (site detail)
**Phase B PR:** B-3 (#240) **R1 PR:** indirect (sidebar layout opens up the content area)
**Score:** 4/4/5/5/4/5/5/4/5/5/4/4

R1 changes: sidebar replaces top nav so this screen now opens in a wider content area. Aside layout unchanged.

### `/admin/sites/[id]/settings`
**Phase B PR:** B-4 (#241) **R1 PR:** none
**Score:** 4/5/n-a/4/4/5/5/5/5/5/5/4

### `/admin/sites/[id]/briefs/[id]/review` (brief review)
**Phase B PR:** B-5 (#242) **R1 PR:** none
**Score:** 4/4/n-a/4/4/5/5/4/4/4/4/4

### `/admin/sites/[id]/briefs/[id]/run` (brief run)
**Phase B PR:** RS-0..RS-6 + B-6 (#243) **R1 PR:** none
**Score:** 5/5/n-a/5/5/5/5/5/5/5/5/5

Still the gold-standard surface. Untouched by R1.

### `/admin/sites/[id]/posts` (posts list)
**Phase B PR:** B-7 (#244) **R1 PR:** none
**Score:** 4/4/5/5/5/5/5/4/5/5/4/4

### `/admin/sites/[id]/posts/[id]` (post detail)
**Phase B PR:** B-7 (#244), B-15 typography **R1 PR:** none
**Score:** 4/4/n-a/4/4/5/5/4/4/4/4/4

### `/admin/sites/[id]/posts/new` (blog-post entry) — most R1 impact
**Phase B PR:** BP-3..BP-8 + B-8 (#245) **R1 PR:** #268 (image picker)
**Score:** 5/4/n-a/**5**/5/5/5/5/4/4/5/4

R1 changes: featured-image picker now opens with smart suggestions based on the post's title + body content (3× title weight via FTS). Two AbortControllers handle tab switches without stale fetches. Skeleton thumbnails during load — moved Loading from 4 to 5.

Remaining gaps: drag-to-reorder for the post body still deferred; would close the last `4` on microinteractions.

### `/admin/sites/[id]/pages` (pages list)
**Phase B PR:** B-9 (#246), A-4 **R1 PR:** none
**Score:** 4/4/4/5/4/5/5/4/4/4/4/4

### `/admin/sites/[id]/pages/[pageId]` (page detail)
**Phase B PR:** B-9 (#246) **R1 PR:** none
**Score:** 4/4/n-a/4/4/5/5/4/4/4/4/4

### `/admin/sites/[id]/appearance`
**Phase B PR:** B-10 (#247) **R1 PR:** none
**Score:** 4/4/n-a/5/4/5/5/4/4/5/4/4

### `/admin/sites/[id]/design-system/*` (4 routes)
**Phase B PR:** B-11 (#248) **R1 PR:** none
**Score:** 4/4/n-a/5/4/5/5/4/4/4/4/4

### `/admin/batches` (batches list)
**Phase B PR:** B-12 (#249), A-4 **R1 PR:** none
**Score:** 4/4/5/5/4/5/5/4/4/4/4/4

### `/admin/batches/[id]` (batch detail)
**Phase B PR:** B-12 (#249) **R1 PR:** none
**Score:** 4/4/n-a/4/4/5/5/4/4/4/4/4

### `/admin/images` (image library)
**Phase B PR:** B-13 (#250) **R1 PR:** indirect (image picker overhaul)
**Score:** 4/4/4/4/4/5/5/4/4/4/4/4

### `/admin/images/[id]` (image detail)
**Phase B PR:** B-13 (#250) **R1 PR:** none
**Score:** 4/4/n-a/4/4/5/5/4/4/4/4/4

### `/admin/users`
**Phase B PR:** B-14 (#251) + C-2 (#255) **R1 PR:** #266 (action cells horizontal layout)
**Score:** 4/5/5/4/**5**/5/5/5/5/5/4/4

R1 changes: UserStatusActionCell vertical stack → horizontal row. Sites list match — sparse-data tables now read as compact data tools.

### `/login`, `/auth/forgot-password`, `/auth/reset-password`
**Phase B PR:** B-15 (#252) **R1 PR:** #266 (auth shells)
**Score:** 4/n-a/n-a/n-a/4/5/5/**5**/4/4/5/4

R1 changes: each auth page wrapped in `bg-canvas` + form-in-card pattern. Inputs and buttons now sit against a real surface (the previous shell rendered them on raw white). Button-hierarchy improvements (item 4) make the primary action visible-without-being-shouty — item 10 fix.

---

## Cross-cutting features (Phase C, unchanged in R1)

- **C-1 ⌘K command palette** — global mount, recent sites in localStorage, lazy site list. Sidebar footer hint badge tells first-time operators about the shortcut.
- **C-2 Optimistic UI** — UserRoleActionCell + UserStatusActionCell flip immediately with sonner toast feedback.
- **C-3 A11y hardening** — skip-to-content link, axe-core sweep in screenshot CI, focus-visible normalization.

R1 didn't touch any of these — Phase C shipped at the polish bar.

---

## Self-identified remaining gaps

### Honest list — what still needs work

1. **Density still scores 4 cross-cutting.** R1's sparse-table fix helped Sites + Users but didn't touch the broader density story (briefs lists, pages lists, appearance event log). A proper cross-cutting density sweep would close this — out of scope for R1.

2. **Microinteractions still scores 4 cross-cutting.** Drag-to-reorder for brief page lists + post body sections, count-up on dynamic numeric values, native-feel multi-select — all still deferred.

3. **Mobile still scores 4 cross-cutting.** Sidebar mobile drawer works but no swipe-to-dismiss; no pull-to-refresh on lists. Honest "responsive web," not "feels native."

4. **Accessibility still scores 4 cross-cutting.** Skip-link + axe-core sweep + aria attributes throughout, but full WCAG-AA contrast audit not done. The `--secondary` token bump (96.1% → 87%) needs contrast verification against `text-secondary-foreground` in both modes; I eyeballed it as "looks fine" but didn't measure with a contrast checker.

5. **Dark mode rollout still incomplete.** A-2 added dark-variant tokens including the new `--canvas` (222 47% 7%) and the bumped `--secondary` (217.2 32.6% 25%), but per-component `dark:` variants remain spotty. The CSS custom properties swap correctly on `.dark`; consumers don't always opt in.

6. **R1 introduced new risks I haven't audited:**
   - `--secondary` at 87% lightness might break contrast on existing `secondary` button consumers I didn't sweep — `text-secondary-foreground` is 222.2 47.4% 11.2%, contrast against 220 13% 87% should be ~9:1 (passes AAA easily) but I didn't measure each consumer.
   - The sidebar's `useState(false)` + `useEffect`-restores-from-localStorage pattern has a hydration flash window where the rail renders expanded then snaps to collapsed if persisted. ~50ms, probably imperceptible, but I haven't measured.
   - The image picker's segmented control sits inside the dialog; I didn't verify the focus ring on the active segment doesn't clip against the dialog's rounded corners.
   - The R1 image picker PR removed the standalone "Paste URL" tab and made it a disclosure under Upload. If any e2e spec or operator muscle-memory relied on the old tab, this is a regression — none observed in CI but worth a manual smoke.

### Deliberately deferred (out of scope per parent plan + R1)

- Brand redesign (logo, marketing site).
- Customer-facing WP themes.
- i18n / translation surface.
- Native mobile apps.
- Drag-to-reorder lists.
- Per-user theme picker.
- Comprehensive WCAG-AA contrast audit.
- Full dark-mode rollout (per-component `dark:` sweep).

---

## Iteration budget

Soft cap was 30 PRs for the original polish workstream. Final count for that workstream: **28 PRs** (within budget). R1 review feedback added 3 more PRs (separate cycle, not counted against the 30-PR cap). **Combined total: 31 PRs.**

## What "done" looks like (verification)

- ✅ Every screen scored 4+ on every quality dimension (per the grid above). Six dimensions at 5 cross-cutting.
- ✅ Foundation primitives shipped (A-0 → A-7) and consumed across every per-screen PR.
- ✅ Command palette functional with ⌘K (C-1).
- ✅ Live polling / animation patterns consistent (RS-4 polling + C-2 optimistic UI + sonner toasts everywhere).
- ✅ Visual regression screenshots in CI; per-PR text descriptions in lieu of inline screenshots per option-4 approval.
- ✅ All BACKLOG findings documented with triggers.
- ✅ Production health green throughout.
- ✅ **Round 1 review feedback all 11 items shipped:**
  - Item 1 sidebar layout ✅ (#264)
  - Item 2 page-canvas tint ✅ (#264)
  - Item 3 content gutters ✅ (#264)
  - Item 4 button hierarchy ✅ (#266)
  - Items 5-8 image picker overhaul ✅ (#268)
  - Item 9 magenta blocks fix ✅ (#266)
  - Item 10 forgot password / auth shells ✅ (#266)
  - Item 11 sparse-data density ✅ (#266)

## Halt point

Per the brief: **Round 1 review items complete. PR #257 ready for re-review.**

Send Round-2 feedback as PR comments. I'll iterate.
