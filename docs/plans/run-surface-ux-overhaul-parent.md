# Run-surface UX overhaul — parent plan

## What it is

Polish the brief upload + run surface so an operator can drive a brief end-to-end without UX friction or manual browser refresh. UAT smoke 1 surfaced 6 issues across the brief upload, commit, and run surfaces (Issues 1–6 of the operator's punch list). The seventh — single blog-post creation — lives in the sibling parent plan `docs/plans/blog-post-workflow-parent.md`.

Quality bar: Vercel deployment dashboard, Linear, Claude.ai composer. Information-dense, live-updating, smooth transitions, mobile-first responsive.

## Cross-cutting decisions (apply across all sub-slices)

| Decision | Choice | Why |
|---|---|---|
| **Real-time pattern** | Polling at **4s interval** | Lowest-risk per the standing rule. No new dep surface. Simple visibility/teardown semantics. Supabase Realtime / SSE deferred to a BACKLOG entry if 4s latency proves operator-noticeable. |
| **Design tokens** | Use existing `app/globals.css` HSL custom-property tokens | Already shadcn-shaped. No new design-system layer needed; sub-slice 0 adds Radix Dialog / Tooltip / Popover primitives + animation utility classes. |
| **Mobile floor** | 380px viewport, no horizontal scroll, 44×44px tap targets | Every sub-slice's acceptance criteria pins this. |
| **Stale claim cleanup** | `docs/WORK_IN_FLIGHT.md` carries a stale Session A claim from 2026-04-24 | Verified inactive; no concurrent edits expected. Sub-slices may add their own claim blocks if Steven runs a parallel session. |
| **State management surface** | One polling hook, declared once in `lib/use-poll.ts`, consumed by every live-updating component | Prevents per-component drift. Establishes pattern for Issue 7 too. |

## Required env vars

None new. (Outbound URL fetch in the sibling blog-post plan needs no allowlist for v1; documented there.)

## Sub-slice breakdown (7 PRs)

| Slice | Scope | Effort | Blocks on | Shared with blog-post plan? |
|---|---|---|---|---|
| **RS-0** | Foundation primitives — Radix Dialog/Tooltip/Popover/Command via shadcn; animation/transition utility classes | S | — | Yes (BP-3, BP-4 consume) |
| **RS-1** | Unified composer — single textarea + paste + drag-drop file + click-attach. Replaces `UploadBriefModal`'s mode toggle | M | RS-0 | **Yes** (BP-3 consumes; whichever ships first builds) |
| **RS-2** | Brand voice + design direction → site-level config (schema + Site Settings UI + brief form reads as defaults + per-brief override toggle) | M | — | No |
| **RS-3** | Auto-advance from committed → run surface (drop intermediate "committed" UI) | S | — | No |
| **RS-4** | Live polling infrastructure (`lib/use-poll.ts`) + first consumer (run-surface status / cost) | M | RS-0 | Yes (BP-* run surfaces consume) |
| **RS-5** | Awaiting-review CTA + page card visual distinction + run-level badge text + click-to-jump | M | RS-4 | No |
| **RS-6** | Cost ticker — bottom-right floating, sticky, animated. Model strings collapse into "Run details" expandable | S | RS-4 | No |

**Effort key:** S = under 2 hours, M = ½–1 day, L = 1+ days (single contributor).

**Total estimated effort:** ~3–4 days serial; ~2 days with parallelism on RS-2/RS-3.

## Execution order

```
[serial]    RS-0 (primitives) — foundation
[serial]    RS-1 (unified composer) — uses RS-0
[parallel]  RS-2 (brand voice) ─┐
[parallel]  RS-3 (auto-advance) │ — no deps among each other
[serial]    RS-4 (polling)      ┘ — uses RS-0
[serial]    RS-5 (awaiting-review) — uses RS-4
[serial]    RS-6 (cost ticker)    — uses RS-4
```

RS-2 and RS-3 may ship in either order after RS-0/RS-1. RS-5 and RS-6 may ship in either order after RS-4.

---

## RS-0 — Foundation primitives

### Scope

Add the Radix-based shadcn primitives required by RS-1+ but not yet in `components/ui/`. Add a small set of motion / transition utility classes to `app/globals.css` so animated state changes (RS-4 status pills, RS-6 cost ticker) have a shared vocabulary.

### What lands

- `components/ui/dialog.tsx` — Radix Dialog wrapper. Replaces RS-1's hand-rolled `fixed inset-0` modal.
- `components/ui/tooltip.tsx` — Radix Tooltip. Used by RS-6 (model-string disclosure) + future hover hints.
- `components/ui/popover.tsx` — Radix Popover. Used by BP-4 image picker.
- `components/ui/command.tsx` — `cmdk` (Command palette / searchable list). Used by BP-4.
- `app/globals.css` — utility classes for `.transition-smooth` (200ms ease-in-out), `.fade-in`, `.slide-up` keyframes. Respect `prefers-reduced-motion` via `@media (prefers-reduced-motion: reduce)` zeroing all motion.
- `package.json` — `@radix-ui/react-dialog`, `@radix-ui/react-tooltip`, `@radix-ui/react-popover`, `cmdk` deps.

### Acceptance criteria

- All 4 primitives render correctly in a Storybook-equivalent (one-off page or component snapshot).
- `prefers-reduced-motion: reduce` zeros animations.
- 380px viewport: dialog + popover + tooltip don't overflow horizontally.
- 44×44px tap targets on the dialog close button + popover trigger.
- `npm run lint` + `npm run typecheck` clean.
- `npm run build` clean (no new bundle bloat warnings).

### Risk audit

- **New runtime dep surface.** Radix is well-established and tree-shakes; cmdk is a small dep. Each adds ~5–15KB gzipped. Tracked via `npm run analyze`.
- **CSS-in-CSS drift.** New utility classes in `app/globals.css` can collide with future Tailwind config changes. Naming uses a `.opollo-` prefix on motion classes to avoid collision.
- **Reduced-motion regression.** Forgetting the media-query zeroing breaks accessibility. Pinned in the test plan via a snapshot diff at `prefers-reduced-motion: reduce`.

### Test plan

- Unit / component tests on the 4 primitives' open/close behavior.
- Manual: 380px iPhone viewport check via DevTools.
- Manual: macOS System Settings → Accessibility → Display → Reduce motion check.

### Effort

S (~2 hours).

---

## RS-1 — Unified composer

### Scope

Replace the mode-toggle (Upload file / Paste text) in `UploadBriefModal.tsx` with a Claude.ai-style composer: a single resizing textarea, paste accepted, drag-and-drop file accepted, click-"+" file picker accepted. No mode switching.

The composer becomes a shared component (`components/Composer.tsx`) consumed by both the brief upload modal and the blog-post entry point (BP-3). Whichever ships first builds; second consumes.

### What lands

- `components/Composer.tsx` — shared component with props: `value`, `onValueChange(text)`, `onFileAttached(file)`, `placeholder`, `accept` (MIME types). Auto-grows up to ~12 lines, then scrolls. Supports paste (text inline) and drag-drop file (file event). "+" button opens file picker.
- `components/UploadBriefModal.tsx` — refactored to consume `Composer`. Drops the radio `SourceMode` toggle. Modal scrolls within viewport via `Dialog` (RS-0) + max-height container.
- Visual: input border highlights on drag-over. File-attached state shows filename pill above the textarea with an "x" to remove.

### Acceptance criteria

- Modal **scrolls within viewport** on 380px height (height-constrained mobile case).
- 380px viewport: composer doesn't overflow horizontally.
- Drag-drop accepts the same MIME types as the file picker (text/markdown, text/plain — `.md`, `.txt`).
- Paste of a large text block flows into the textarea (no clipboard intercept).
- "+" button is 44×44px tap target.
- File-attached pill is 44px tall.
- Submit button enabled when (text non-empty) OR (file attached). Both filled = file wins (matches existing form-data semantics — server side already handles).
- Existing E2E spec for brief upload still passes. Tests updated to use the new composer affordance instead of the radio.
- `npm run lint` + `npm run typecheck` + `npm run build` clean.

### Risk audit

- **Existing UploadBriefModal API broken.** Audit and update the call site at `components/SitesListClient.tsx` (or wherever it opens). Drop the `SourceMode` state.
- **Form-data wire format unchanged.** Server route accepts both `file` and `pasted_text` form fields; RS-1 still sends one of them based on user input. No server changes.
- **E2E spec drift.** `e2e/briefs-review.spec.ts` likely clicks the radio. Update to drag-drop or type-in directly. If the spec is `test.fixme`'d (per BACKLOG residue), this stays out of scope.
- **Drag-and-drop fallback on browsers without HTML5 DnD.** Composer falls back to "+" button; document that DnD is best-effort.

### Test plan

- Component test on `Composer` — paste, drop, click-"+".
- E2E `e2e/briefs-review.spec.ts` runs through the new composer (skip-fixme'd test continues to skip; new active spec covers paste).
- Manual: 380px viewport, full-height drag-drop visual.

### Effort

M (~½ day).

---

## RS-2 — Brand voice + design direction → site-level config

### Scope

Migrate `brand_voice` + `design_direction` from per-brief fields to site-level defaults. Brief form reads them as defaults; operator can override per-brief behind a "Customize for this brief" toggle (collapsed by default).

### What lands

- **Schema migration**: add `sites.brand_voice text` + `sites.design_direction text` (nullable; existing rows default to NULL). One forward migration, no destructive changes. The per-brief `briefs.brand_voice` + `briefs.design_direction` columns stay (operator override still persists per-brief, but defaults populate from the site row).
- `lib/sites.ts` — `getSite` returns the new fields; `updateSiteBasics` / new `updateSiteVoice` helper writes them.
- `app/admin/sites/[id]/settings/page.tsx` (new) OR extend the existing site detail with a "Brand voice & design direction" panel. Authorized via `requireAdminForApi(['admin', 'operator'])`.
- `components/BriefReviewClient.tsx` — defaults the brand_voice + design_direction fields from site values; collapsible "Customize for this brief" panel.
- `components/UploadBriefModal.tsx` — same default + override pattern at upload time so the operator sees the inheritance immediately.
- E2E covering: edit site brand voice → upload brief → form pre-populated → override → commit → run row carries the override.

### Acceptance criteria

- Site-level brand voice / design direction editable on the admin Site Settings surface.
- Brief form pre-populates from site row.
- Override toggle is collapsed by default; expanding reveals the editable fields.
- Override does NOT mutate the site-level row.
- A site with no voice/direction set still works — defaults to empty (current behaviour).
- Mobile: forms fit 380px without horizontal scroll. Toggle is a 44px tap target.
- Migration is forward-only. Rollback file added.
- `npm run lint` + `npm run typecheck` + `npm run build` clean.

### Risk audit

- **Schema migration on `sites`.** New nullable columns are safe. Lease-coherence and version_lock unaffected.
- **Operator confusion: which value is "active"?** UI explicitly labels the override block ("Customize for this brief — overrides the site default"). Site-level value visible above when collapsed.
- **Existing briefs with per-brief voice set.** Continue to use the brief's value (not the site default). Migration doesn't backfill the site-level field — operator sets it explicitly per site.
- **Concurrent site-settings edit + brief upload.** Brief upload reads site.brand_voice at form-load time; if operator edits site-level after, the upload form is stale. Acceptable — refresh picks up the new value. CAS not needed for this read.

### Test plan

- Migration up + down.
- Unit on `updateSiteVoice` helper — round-trip.
- Component snapshot of Site Settings panel + override toggle.
- E2E flow: site settings → brief upload (defaults visible) → override → commit → run.

### Effort

M (~1 day, mostly schema + UI surface).

---

## RS-3 — Auto-advance from committed → run surface

### Scope

After brief commit, the user lands on `/run` directly instead of seeing the "committed" intermediate state. The "committed" status exists in the DB (it's the schema-level marker for runner-eligible) but no UI surface for it.

### What lands

- `components/BriefReviewClient.tsx` — on successful commit response, `router.push(\`/admin/sites/\${siteId}/briefs/\${briefId}/run\`)` instead of refreshing the review page.
- The post-commit panel that currently renders for `brief.status === "committed"` is deleted from the review surface (the user never sees it). Server-side, the status remains `'committed'` and unchanged.

### Acceptance criteria

- Brief commit → operator lands on `/run` within 1 second (network + Next.js client-side nav).
- Review surface no longer renders the committed-state panel.
- Direct navigation to `/admin/sites/[id]/briefs/[briefId]/review` for an already-committed brief redirects to `/run` (server-side `notFound()` stays for non-existent briefs; new `redirect()` for committed-but-existing).
- Mobile: redirect happens regardless of viewport.
- Existing E2E tests for commit flow updated.
- `npm run lint` + `npm run typecheck` + `npm run build` clean.

### Risk audit

- **Operator was relying on the committed-state CTAs.** The two CTAs ("Back to briefs", "Open run surface") now flow automatically — operator goes straight to the run surface. "Back to briefs" available in the breadcrumb.
- **Server-side redirect requires careful Next.js handling.** Server component: check `brief.status === "committed"` → call `redirect()` from `next/navigation`. Tested.
- **Edge case: operator opens review on a committed brief from the briefs list.** Flow: list → click brief → server component sees committed → redirect to /run. Not a regression; seamless.

### Test plan

- E2E: upload → parse → commit → assert URL is /run within 2s.
- E2E: navigate to /review for a committed brief → assert redirect to /run.
- Component test: BriefReviewClient committed-state branch is dead code (assertion: panel not rendered).

### Effort

S (~1 hour).

---

## RS-4 — Live polling infrastructure

### Scope

Add a single `lib/use-poll.ts` hook that polls a server route every 4s, pauses on tab visibility loss, and returns the latest snapshot + `isStale` flag. First consumer: the run surface — auto-update brief_run.status, run_cost_cents, page_status across all pages.

### What lands

- `lib/use-poll.ts` — generic hook: `usePoll<T>(url, intervalMs = 4000, opts?)`. Pauses on document visibility hidden, resumes on visible. Exposes `data`, `error`, `isStale` (last fetch > intervalMs * 2). Server URL must accept GET and return JSON.
- `app/api/briefs/[brief_id]/run/snapshot/route.ts` (new) — GET endpoint returning a typed `BriefRunSnapshot` (run + pages + cost) for the polling consumer. Service-role read.
- `components/BriefRunClient.tsx` — consumes `usePoll` for the run + pages snapshot. `router.refresh()` no longer required for state changes.
- Status pills animate on transition (`opollo-fade-in` from RS-0 utility classes).
- Cost number animates ticker via `IntersectionObserver`-friendly transition; smooth count-up (no jank on every poll).

### Acceptance criteria

- Run surface auto-updates within 5s of a server-side state change (worst case = poll interval just missed).
- Tab in background pauses polling. Returning to tab triggers an immediate fetch.
- Status pill transition: 200ms `transition-smooth`. No jank on every poll (only animates on actual change).
- Cost number animates from old → new value over 600ms when value changes.
- Network failure: polling continues, marks stale; UI shows a discreet "reconnecting…" indicator.
- 380px viewport: status pill + cost ticker still readable.
- E2E: drive a brief from queued → running → paused, observe UI updating without manual refresh.
- `npm run lint` + `npm run typecheck` + `npm run build` clean.

### Risk audit

- **Polling at 4s × 100 concurrent operators = 25 req/s baseline load.** Acceptable; the snapshot endpoint is a simple SELECT. Indexed on (brief_run_id, brief_id). Add `Cache-Control: no-store` so CDN doesn't cache stale data.
- **Snapshot route exposes new attack surface.** Auth: require admin/operator session via `requireAdminForApi`. Route returns only the brief's own data — site-scope guard via `brief.site_id` check.
- **Race: snapshot fetched mid-write.** Reads see the row at one instant; client renders that instant. Eventual consistency — polling closes the gap within 4s.
- **Animation jank from per-poll re-render.** Use `useMemo` on derived UI state so React doesn't re-render the whole tree when nothing changed.

### Test plan

- `lib/__tests__/use-poll.test.ts` — interval ticking, pause-on-hidden, error path, isStale flag.
- Component test on BriefRunClient with stubbed `usePoll`.
- E2E: drive a brief and observe live updates.

### Effort

M (~1 day).

---

## RS-5 — Awaiting-review CTA + page card distinction + run badge clickable

### Scope

When a brief_run is `paused` with one page in `awaiting_review`:
- That specific page card visually distinct (highlighted border, distinct pill colour vs Pending).
- "Review now →" CTA button on the page card, jumps to expanded preview / scrolls into view.
- Run-level badge text changes from "Awaiting your review" to "Page N awaiting your review".
- Run-level badge is clickable, jumps to first awaiting-review page.

### What lands

- `components/BriefRunClient.tsx`:
  - Page card for `awaiting_review` status: `border-yellow-500/40 ring-2 ring-yellow-500/20` (distinct from Pending's `border-muted`).
  - Pill colour: amber (`bg-amber-500/10 text-amber-900`) vs Pending's `bg-muted`.
  - "Review now →" button on the card; scrolls the card into view + auto-expands the preview disclosure.
  - Run-level badge shows ordinal: `"Page \${ordinal + 1} awaiting your review"`.
  - Badge is wrapped in a `<button>` that calls scroll-into-view on the awaiting-review card.

### Acceptance criteria

- Awaiting-review card visually distinct on every viewport (380px+).
- Pill colour passes WCAG AA contrast against the card background.
- Click on the run-level badge scrolls smoothly to the awaiting-review page card; preview expands.
- "Review now →" button is 44×44px tap target.
- If multiple pages somehow simultaneously `awaiting_review` (edge: not currently possible per runner, but defensive): badge points to the first one ordinal-wise.
- Mobile: scroll-into-view doesn't break header / nav.
- `npm run lint` + `npm run typecheck` + `npm run build` clean.

### Risk audit

- **Animation conflict with RS-4 polling.** Status pill transitions when value changes; the highlight border + ring DON'T animate (static visual treatment).
- **`scrollIntoView({ behavior: 'smooth' })` on iOS Safari.** Falls back to instant scroll if smooth not supported. Acceptable.
- **Edge case: zero pages awaiting review but run is `paused`.** Should never happen given the runner's transition rules, but if it does: badge text falls back to "Awaiting your review" (today's text); no link.

### Test plan

- Component snapshot on the awaiting-review variant.
- E2E: drive run to paused state, click badge, assert preview expands.
- Manual: WCAG contrast check via DevTools.

### Effort

M (~½ day).

---

## RS-6 — Cost ticker (compact creative placement)

### Scope

Replace the full-width cost card with a bottom-right floating ticker. Sticky across run-surface scroll. Animates as cost ticks up. Model strings (currently inline in the cost card) move to an expandable "Run details" section accessible via a small "i" icon → Tooltip (RS-0 primitive).

### What lands

- `components/RunCostTicker.tsx` (new) — `position: fixed; bottom: 1rem; right: 1rem; z-index: 50;`. Shows `$X.YY` total run cost. Animates count-up on change (reuses RS-4's animation primitive). Click expands a compact panel with: per-page cost breakdown, model strings, idempotency keys (debug-only).
- `components/BriefRunClient.tsx` — drops the existing cost card from the layout. Renders `<RunCostTicker />` at the page root.
- Mobile: ticker is full-width-bottom on 380px (overlay ribbon, not bottom-right corner).

### Acceptance criteria

- Ticker visible across the entire run surface scroll without manual scroll-back.
- Cost change triggers count-up animation (600ms, monotonically increasing).
- Click expands "Run details" panel; click again collapses.
- 380px viewport: ticker is full-width-bottom (not overlapping content).
- 44×44px tap target on the expand button.
- WCAG contrast: ticker background ≥ 4.5:1 against page content.
- `npm run lint` + `npm run typecheck` + `npm run build` clean.

### Risk audit

- **z-index collision with future modals.** Ticker uses `z-50`; future modals use `z-[100]+`. Documented in the file header.
- **Mobile-bottom overlay obscures touch on lower-screen content.** Acceptable trade-off; ticker is small (~40px tall) and operator can dismiss the expanded panel.
- **Sticky positioning on iOS Safari.** Verified — `position: fixed` works on Safari iOS.

### Test plan

- Component snapshot of collapsed + expanded states.
- E2E: navigate run surface, scroll, assert ticker stays visible.
- Manual: 380px viewport, expand panel, assert no content occlusion.

### Effort

S (~2–3 hours).

---

## Write-safety contract (parent-level)

- **No new write paths.** All sub-slices are UX-layer changes. Existing CAS / version_lock / idempotency contracts are preserved.
- **Polling endpoint is read-only.** RS-4's snapshot route is a SELECT only; no mutations.
- **Schema migration in RS-2 is forward-only and additive.** New nullable columns; no destructive change. Rollback file included.
- **Existing E2E coverage extended, not replaced.** RS-1's composer change updates `e2e/briefs-review.spec.ts` to use the new affordance; the spec's coverage envelope stays the same.

## Risks identified and mitigated (parent-level)

| Risk | Mitigation |
|---|---|
| Stale concurrent-session edits land on shared files (BriefRunClient.tsx) | Per the standing rule: rebase before every push; resolve conflicts in favour of preserving both changes. WORK_IN_FLIGHT.md verified — Session A's claim is from 2026-04-24 and the slice is shipped. |
| Polling load on snapshot route under multiple operators | 4s × small SELECT = trivial. Add `Cache-Control: no-store`. Indexed on the keyed columns. |
| RS-2 schema migration conflicts with concurrent migration | Migration number reserved at the top of the slice's PR description (next available is `0028`). |
| Design-token drift between sub-slices | All sub-slices consume `app/globals.css` HSL custom-property tokens. RS-0 adds animation utilities only — no new color / type / spacing tokens introduced. |
| Mobile breakage on a niche viewport | Acceptance criteria pin 380px as the floor. Wider viewports auto-pass. |
| RS-4 polling conflicts with Next.js cache layer | Snapshot route is `runtime = "nodejs"` + `dynamic = "force-dynamic"` + `Cache-Control: no-store`. Polling fetches bypass Next.js's data-cache. |

## Pointers

- `docs/INTEGRATION_MODEL_DECISION.md` — path B context (host theme owns chrome).
- `docs/plans/blog-post-workflow-parent.md` — sibling plan; RS-1 unified composer is shared.
- `docs/patterns/ship-sub-slice.md` — every PR follows this shape.
- `app/globals.css` — design-token source of truth.
- `components/UploadBriefModal.tsx` — primary refactor target for RS-1.
- `components/BriefReviewClient.tsx` — refactor for RS-2 + RS-3.
- `components/BriefRunClient.tsx` — refactor for RS-4 / RS-5 / RS-6.
- `lib/use-poll.ts` (new) — RS-4 deliverable; future live-update consumers cite this.

## Sub-slice status tracker

(filled in as PRs land)

| Slice | PR | Merged | Notes |
|---|---|---|---|
| RS-0 | — | — | — |
| RS-1 | — | — | — |
| RS-2 | — | — | — |
| RS-3 | — | — | — |
| RS-4 | — | — | — |
| RS-5 | — | — | — |
| RS-6 | — | — | — |
