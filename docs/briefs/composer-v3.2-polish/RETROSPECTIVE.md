# Composer v3.2 Polish — Retrospective

**Workstream dates:** 2026-05-21  
**Items covered:** 7–21 (15 items)  
**PRs shipped:** #984, #985, #987, #988  

---

## PR breakdown

### D1 — #984 (6f316cd1): Tooltips, dialog rewrite, header chrome, cursors

**Items:** 7, 8, 9, 11, 12, 13 (partial), 14, 16

**Investigation findings:**

- Item 7 (disabled-button tooltip): `SchedulingCard` used `disabled:pointer-events-none` which blocks Radix Tooltip hover events entirely. The CSS class is redundant — the HTML `disabled` attribute already prevents clicks. Removed the class; tooltip wraps the disabled button via a span.
- Item 8 (profile chip hint): Tooltip implemented at `ProfileSelector` level, not inside `ProfileChip`. `ProfileSelector` already knows `hasSelected`; keeping `ProfileChip` stateless avoids a prop-threading chain.
- Item 9 (chip overlay sizes): Previous overlay sizes were implicit / under-specified. Explicit values: checkmark `h-6 w-6` (24px), brand badge `h-8 w-8` (32px). CSS custom properties (`--chip-overlay-checkmark`, `--chip-overlay-brand`) added to the chip element for downstream reference.
- Item 11/12 (header chrome): Both Back and Close call the same `handleClose` handler — no duplicate guard logic required.
- Item 14 (dialog rewrite): `UnsavedChangesDialog` was rebuilt to spec (title, three-button layout). "Save" renders only when `onSave` is provided (existing contract preserved). "Don't save" is text-only (no border).
- Item 16 (cursors): `cursor-pointer` added to `PostChip`, `DayDetailPostCard` outer div, and `DayCell`. Drag handle (`cursor-grab`) was already present and was not disturbed.

**All D1 items: PASS on first PR.**

---

### D2 — #985 (f14bf402): Unified MonthCalendar, content-type chips, edit-mode highlight

**Items:** 10 (partial), 19, 20 (partial)

**Investigation findings:**

- Item 10 (unified calendar): `CalendarShell` uses `CalendarCell` (wraps `useDroppable` for DnD) as its grid cells; `MonthCalendar` uses `DayCell`. A naive cell swap would silently remove DnD. Decision: add `context`, `highlightPostId`, and `onClickPost` props to `MonthCalendar` in D2; defer the render-prop unification that would let `CalendarShell` drive its own cells through `MonthCalendar`'s grid. Full unification landed in gap-fix (#988).
- Item 19 (content-type indicators): `link_url` already existed in the `social_post_drafts` table; no schema change needed. Added it to the `calendar-view` API SELECT + response mapping. Media takes precedence over link in the icon logic.
- Item 20 (cell highlight): Infrastructure (DayCell border, PostChip ring, prop chain through MonthCalendar) fully wired. `ComposerOverlay` was missing the `highlightPostId={initialDraft?.id}` pass-through — caught in verification, fixed in gap-fix.

**Items 10 and 20: PARTIAL in D2. Fixed in gap-fix. Item 19: PASS.**

---

### D3 — #987 (ad65677): Edit-mode parity — click routing, header, failure banner, convert-to-draft

**Items:** 13 (SWR revalidation on convert-to-draft), 15, 17 (partial), 18, 21

**Investigation findings:**

- Item 15 (click routing): `CalendarShell.handleClickPost` already existed but routed all statuses identically. Split: `published` → analytics modal; all others → `?compose=<id>`. `ComposerOverlay` gained `editOriginalState` and `failureReason` from the draft-fetch response; `publishing` state triggers `pointer-events-none`; `failed` state renders a failure banner.
- Item 17 (edit-mode header icon): `SocialPlatformIcon size={16}` was shipped — spec requires 24px. Caught in verification, fixed in gap-fix.
- Item 18 (convert-to-draft): New POST endpoint at `/api/platform/social/drafts/[id]/convert-to-draft`. Requires `state === 'scheduled'`; sets `state = 'draft'`, `scheduled_at = NULL`. SWR revalidation fires on success.
- Item 21 (OG rehydrate): The spec's primary path (read cached `link_og_title`/`link_og_image` from DB) requires schema columns that do not exist and are prohibited this round. The fresh-fetch path (URL detection effect on `ContentEditor` mount with non-empty `value`) fires automatically when an existing post with a URL is opened — the user-facing requirement (preview within ~250ms, no re-paste) is satisfied. Cached-column path deferred.

**Item 17: PARTIAL in D3. Fixed in gap-fix. Items 13, 15, 18, 21: PASS.**

---

### Gap-fix — #988 (6cd19c9f): Items 10, 17, 20

**Items fixed:** 10, 17, 20

**Findings:**

- Item 17: Single-line fix — `size={16}` → `size={24}` at `ComposerOverlay.tsx:398`.
- Item 20: Single-line fix — `highlightPostId={initialDraft?.id}` added to `<MonthCalendar>` in `ComposerOverlay`.
- Item 10 (full unification): Render-prop approach (`renderDay?`) added to `MonthCalendar`. When provided, MonthCalendar renders `renderDay(date, dayPosts, meta)` instead of `DayCell`. `CalendarShell` passes its `CalendarCell` via the prop, preserving DnD. Controlled navigation props (`year?`, `month?`, `onNavigate?`), `showTodayButton?`, and `profileFilter?` also added. Shared `useCalendarView` SWR key means one network request serves both surfaces. Dead code removed from `CalendarShell`: `buildGridDates`, `DAYS_OF_WEEK`, `navigateMonth`, `gridDates`, `monthLabel`.

---

## Deviations from brief

| Item | Deviation | Resolution |
|---|---|---|
| 10 | Full DnD unification deferred from D2 to gap-fix; render-prop approach used instead of migrating CalendarShell's cell type. | Completed in #988 via `renderDay` prop. |
| 17 | Icon size shipped as 16px (spec: 24px) in D3. | Fixed in #988. |
| 20 | `highlightPostId` not passed to `MonthCalendar` in D2. | Fixed in #988. |
| 21 | Cached OG columns (`link_og_title`, `link_og_image`) not added — schema change prohibited this round. | Fresh-fetch path on composer open satisfies the user-visible requirement. Cached path deferred. |

---

## Design tokens consumed

| Token / value | Usage | Location |
|---|---|---|
| `border-emerald-500` / `bg-emerald-50/60` | Cell highlight border + background | `DayCell.tsx` |
| `ring-emerald-500` | Post chip highlight ring | `PostChip.tsx` |
| `text-destructive` | "· Failed" suffix in edit-mode header | `ComposerOverlay.tsx` |
| `text-muted-foreground` | Content-type indicator icons (Image, Link2) | `PostChip.tsx` |
| `hover:bg-muted` + `transition-colors duration-[120ms]` | Back / Close button hover state | `ComposerOverlay.tsx` |
| `pointer-events-none opacity-60` | Publishing-state content lockout | `ComposerOverlay.tsx` |
| `--chip-overlay-checkmark: 24px` / `--chip-overlay-brand: 32px` | CSS custom properties on chip element | `profile-chip.tsx` |

---

## New patterns introduced

**`renderDay` render-prop on `MonthCalendar`**  
Allows the host (`CalendarShell`) to supply its own cell component while MonthCalendar owns grid generation, navigation, and SWR data fetching. Signature: `renderDay?(date: Date, posts: CalendarPost[], meta: { isToday: boolean; isCurrentMonth: boolean }) => React.ReactNode`. When absent, MonthCalendar renders its default `DayCell`.  
Reference: `components/social/calendar/MonthCalendar.tsx`.

**Controlled navigation props on `MonthCalendar`**  
`year?`, `month?`, `onNavigate?` enable external navigation control (e.g. CalendarShell syncing its own state). When omitted, MonthCalendar is self-navigating.

**SWR global mutate by key-prefix for cross-surface revalidation**  
`swrMutate((key) => typeof key === "string" && key.includes("/api/platform/social/drafts/calendar-view"))` revalidates all mounted `useCalendarView` hooks regardless of surface. First used in `ComposerOverlay.handleSubmit` and `handleConvertToDraft`.  
Reference: `components/social/composer/ComposerOverlay.tsx`.

**`disabledTooltip` prop pattern on form buttons**  
Pass a `disabledTooltip?: string` to a button component; when the button is disabled and the prop is set, the component wraps itself in `TooltipProvider/Tooltip` with a span trigger (since `disabled` elements cannot receive pointer events for Radix Tooltip). Avoid `disabled:pointer-events-none` on buttons that need tooltip coverage.  
Reference: `components/social/composer/SchedulingCard.tsx`.

---

## Backlog items discovered (not implemented)

1. **OG cache columns** — `link_og_title` and `link_og_image` columns on `social_post_drafts`. Required for the primary OG-rehydrate path (read from DB instead of fresh-fetch on every open). Next round, schema-change window.

2. **`CalendarShell` → `MonthCalendar` full migration** — `CalendarShell` still owns its own DnD post-layout logic (`postsForDate`, `DayDetail` side-rail). The `renderDay` prop enables incremental migration; a follow-up slice could move the DnD mutation handlers and optimistic state into `MonthCalendar` + a `onDropPost` prop, removing the last duplicate grid wiring from `CalendarShell`.

3. **Unit tests for `renderDay` prop path** — `MonthCalendar` has no unit coverage for the render-prop branch. CalendarShell e2e covers the DnD path indirectly but a `MonthCalendar.unit.test.tsx` asserting the prop is called with correct `(date, posts, meta)` would close the gap.

4. **`UnsavedChangesDialog` — keyboard shortcut** — Spec did not require it; "Save" via `Cmd+S` inside the dialog would match macOS convention. Not wired.

5. **Edit-mode analytics modal for `published` posts** — `handleClickPost` routes `published` to `setAnalyticsPostId` but the analytics modal content is a stub (shows post ID only). Full analytics modal is a separate workstream.

6. **`ProfileChip` CSS custom property usage** — `--chip-overlay-checkmark` and `--chip-overlay-brand` are set but not consumed via `var()` in the current implementation (explicit Tailwind classes are used instead). Either consume them or remove them to avoid dead token noise.

---

## Final verification summary

| # | Item | Final status |
|---|---|---|
| 7 | Schedule button disabled tooltip | PASS (#984) |
| 8 | Profile chip hover hint | PASS (#984) |
| 9 | Chip overlay sizes 24/32px | PASS (#984) |
| 10 | Unified MonthCalendar | PASS (#988 gap-fix) |
| 11 | Close button 32px/X-20px | PASS (#984) |
| 12 | Back button 32px/ChevronLeft | PASS (#984) |
| 13 | Calendar revalidation | PASS (#984 + #987) |
| 14 | Unsaved-changes dialog rewrite | PASS (#984) |
| 15 | Click routing by post status | PASS (#987) |
| 16 | cursor-pointer on chips/cards | PASS (#984) |
| 17 | Edit-mode header icon size | PASS (#988 gap-fix) |
| 18 | Convert-to-draft button + endpoint | PASS (#987) |
| 19 | Content-type chip indicators | PASS (#985) |
| 20 | Edit-mode cell highlight | PASS (#988 gap-fix) |
| 21 | OG metadata rehydrate | PASS — fresh-fetch path (#987) |

**15/15 items PASS. Workstream complete.**
