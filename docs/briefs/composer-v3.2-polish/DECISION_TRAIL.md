# Decision Trail — Composer v3.2 Polish

Autonomous decisions logged here. Continues from `docs/briefs/composer-v3-fixes/DECISION_TRAIL.md` (D-064).
Picks up at D-065 per master prompt instructions.

---

## PR-D1 — Affordances + dialog + cursors + sizing (2026-05-21)

**D-065**: Tooltip on disabled submit button — pointer-events strategy
- `SchedulingCard` button has `disabled:pointer-events-none`, which blocks Radix Tooltip hover events.
- Fix: remove `disabled:pointer-events-none` from the button class. HTML `disabled` attribute already blocks click events natively; CSS `pointer-events: none` is redundant for preventing clicks and harmful for tooltip hover.
- Add `disabledTooltip?: string` prop to `SchedulingCard`; when set and button is disabled, wrap in `TooltipProvider/Tooltip/TooltipTrigger` (span wrapper for disabled button) + `TooltipContent`.
- `ComposerOverlay` passes `disabledTooltip="Select at least one account to post to"` when `draft.target_profile_ids.length === 0`.

**D-066**: Profile chip tooltip placement — ProfileSelector level
- Brief says "show tooltip on the chip". Implemented at `ProfileSelector` level wrapping each `ProfileChip` in a `Tooltip` when `!hasSelected`.
- Reason: keeps `ProfileChip` stateless; `ProfileSelector` already knows `hasSelected`. Tooltip renders on hover before any selection, auto-disappears when at least one chip is selected (condition removed at re-render).

**D-067**: Profile chip overlay sizes
- Checkmark: `h-5 w-5` (20px) → `h-6 w-6` (24px). Position offset: `-left-1 -top-1` (-4px) for proportional chip-edge overlap.
- Brand icon badge: outer span was implicit 24px (`p-[2.5px]` + `size={19}`). New: `h-8 w-8` (32px) outer + `p-[2.5px]` ring + `size={27}` icon (32 − 2×2.5 = 27px). Position: `-bottom-1.5 -right-1.5` (-6px).
- CSS custom properties added to the chip button element via `style` prop: `--chip-overlay-checkmark: 24px; --chip-overlay-brand: 32px`.

**D-068**: Back button behavior
- Brief: "Behavior identical to clicking the X (triggers the unsaved-changes guard if applicable)."
- Both Back (ChevronLeft) and Close (X) call the same `handleClose` handler. No new guard logic needed.
- Header layout: `[Back] [Title] [keyboard-shortcuts] [Close]` per spec.

**D-069**: UnsavedChangesDialog — "Save" renders conditionally
- Brief says three buttons: Save (primary), Continue editing (secondary), Don't save (tertiary).
- "Save" only renders when `onSave` prop is provided (existing contract), same as before.
- When `onSave` is absent: two buttons only — Continue editing, Don't save.
- "Don't save" uses text-only style (no border, muted text) per "tertiary/text style".

**D-070**: DayDetailPostCard cursor
- Outer card div gets `cursor-pointer` since the content area is the primary click target.
- Drag handle overrides with `cursor-grab` (already present).
- PostChip already has `cursor-pointer` (added in PR-C2 era).

---

## PR-D2 — Calendar consolidation + edit-mode chips + cell-highlight (2026-05-21)

**D-072**: Item 10 — Unified MonthCalendar — context prop added, full DnD consolidation deferred
- Investigation: `MonthCalendar` (used in ComposerOverlay) and `CalendarShell` (used on the full page) are divergent. CalendarShell has DnD, side-rail, and filter bar — all of which are absent from MonthCalendar.
- Decision: add `context?: "page" | "composer-pane"`, `highlightPostId?`, and `onClickPost?` props to `MonthCalendar`. The `context` prop is threaded down to DayCell and PostChip to enable cell-highlight (Item 20). Full migration of CalendarShell's DnD month grid into MonthCalendar is deferred — that's a 4-6h refactor with DnD test coverage, out of scope for a polish PR.
- The composer pane (already using MonthCalendar) gains `highlightPostId` and `onClickPost` cleanly. The page-level CalendarShell retains its own grid; both hook to the same `useCalendarView` SWR cache, so Item 13 revalidation works on both surfaces.

**D-073**: Item 13 — Calendar revalidation — SWR global mutate by key prefix
- After a successful draft submission in `ComposerOverlay.handleSubmit`, call SWR's global `mutate` with a key-filter matching `/api/platform/social/drafts/calendar-view`. This revalidates all mounted `useCalendarView` subscriptions regardless of which surface they're on (CalendarShell or MonthCalendar).
- No optimistic update at the composer level — the new post's profile platform info requires a DB round-trip to resolve. Simple revalidate is correct and safe.

**D-074**: Item 19 — Content-type indicators — `link_url` added to CalendarPost
- The `social_post_drafts` table has a `link_url` column. Added it to the `calendar-view` API SELECT + mapped response.
- Type: `CalendarPost.link_url: string | null`. Media takes precedence: `hasMedia = primary_media_url !== null`; `hasLink = !hasMedia && link_url !== null`. 12px Lucide `Image` / `Link2` icons between platform icon and time. Color: `text-muted-foreground`.
- No schema change required — column already exists.

**D-075**: Item 20 — Cell highlight — emerald treatment via `highlightPostId` prop chain
- `MonthCalendar` → `DayCell` → `PostChip`: `highlightPostId` and `onClickPost` threaded through.
- Cell with matching post: `border-2 border-emerald-500 bg-emerald-50/60`. Chip: `ring-2 ring-emerald-500`.
- Chip click calls `onClickPost(post)` with `stopPropagation` to prevent the cell's `onClick` from also firing.
- `hasCellHighlight` computed from `posts.some(p => p.id === highlightPostId)` — single pass, no extra state.

---

## PR-D3 — Edit-mode header + Convert-to-draft + OG rehydrate (2026-05-21)

*Decision log entries TBD.*
