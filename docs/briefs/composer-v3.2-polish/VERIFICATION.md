# Composer v3.2 Polish — Verification Report

**Date:** 2026-05-21  
**Auditor:** Claude Code (autonomous session)  
**Commits audited:** D1 (#984 / 6f316cd), D2 (#985 / f14bf40), D3 (#987 / ad65677)

---

## Item 7 — Schedule button disabled-state hover tooltip

- PR: #984 (merged SHA 6f316cd1)
- Files changed: `components/social/composer/SchedulingCard.tsx`, `components/social/composer/ComposerOverlay.tsx`
- Spec compliance: **PASS**
- Evidence:
  - `SchedulingCard.tsx:237-256` — wraps disabled button in `TooltipProvider/Tooltip` when `disabledTooltip && (disabled || submitting)`; `TooltipContent data-testid="submit-tooltip"` renders tooltip text
  - `ComposerOverlay.tsx:345-348` — `disabledTooltip={draft.target_profile_ids.length === 0 ? "Select at least one account to post to" : undefined}`
  - `TooltipProvider delayDuration={300}` ✓

---

## Item 8 — Profile chip hover hint when none selected

- PR: #984 (merged SHA 6f316cd1)
- Files changed: `components/social/composer/ProfileSelector.tsx`
- Spec compliance: **PASS**
- Evidence:
  - `ProfileSelector.tsx:35` — `const hasSelected = selected.length > 0;`
  - `ProfileSelector.tsx:39` — `<TooltipProvider delayDuration={300}>`
  - `ProfileSelector.tsx:52-59` — when `!hasSelected`, wraps each chip in `<Tooltip><TooltipTrigger>...<TooltipContent side="bottom">Click to select</TooltipContent>`
  - Tooltip removed once any profile selected (condition on `hasSelected` re-renders without wrapper) ✓

---

## Item 9 — Profile chip overlay sizes (24px checkmark, 32px brand)

- PR: #984 (merged SHA 6f316cd1)
- Files changed: `components/social/profile-chip.tsx`
- Spec compliance: **PASS**
- Evidence:
  - `profile-chip.tsx:88-92` — `style={{ "--chip-overlay-checkmark": "24px", "--chip-overlay-brand": "32px" }}` CSS custom properties
  - `profile-chip.tsx:129-141` — checkmark overlay: `h-6 w-6` (24px), `border-2 border-white` ring ✓
  - `profile-chip.tsx:143-150` — brand badge: `h-8 w-8` (32px), `p-[2.5px]` white ring, `size={27}` icon ✓
  - Outer chip: 56px (`h-14 w-14`); avatar: 52px (`inset-0.5`) ✓

---

## Item 10 — Unified MonthCalendar in page + composer pane

- PR: #985 (merged SHA f14bf402)
- Files changed: `components/social/calendar/MonthCalendar.tsx`, `components/social/calendar/DayCell.tsx`
- Spec compliance: **PARTIAL**
- Evidence:
  - `MonthCalendar.tsx:68` — `context?: "page" | "composer-pane"` prop added ✓
  - `MonthCalendar.tsx:67` — `highlightPostId?: string` prop added ✓
  - `MonthCalendar.tsx:66` — `onClickPost?: (post: CalendarPost) => void` prop added ✓
  - **MISSING**: `CalendarShell.tsx` still uses its own inline grid (CalendarCell, buildGridDates, postsForDate) — D-072 deferred full DnD migration
  - `ComposerOverlay.tsx:563-566` — ComposerOverlay Calendar tab uses `<MonthCalendar>` ✓
- Notes: CalendarShell and MonthCalendar both call `useCalendarView` with the same SWR key (shared cache). Item 13 revalidation works on both surfaces. The page's DnD + side-rail prevents a trivial merge. Full unification requires render-prop refactor — implemented in gap-fix PR.

---

## Item 11 — Top-right close button (32px, Lucide X 20px, hover bg)

- PR: #984 (merged SHA 6f316cd1)
- Files changed: `components/social/composer/ComposerOverlay.tsx`
- Spec compliance: **PASS**
- Evidence:
  - `ComposerOverlay.tsx:427-436` — `h-8 w-8` (32px hit target), `<X size={20} strokeWidth={1.75} />`, `hover:bg-muted transition-colors duration-[120ms]`, `aria-label="Close composer"` ✓
  - Positioned last in header flex row with `px-4` = 16px inset from edge ✓

---

## Item 12 — Top-left Back button (ChevronLeft, 32px, unsaved guard)

- PR: #984 (merged SHA 6f316cd1)
- Files changed: `components/social/composer/ComposerOverlay.tsx`
- Spec compliance: **PASS**
- Evidence:
  - `ComposerOverlay.tsx:379-388` — `<ChevronLeft size={20} />`, `h-8 w-8` (32px), `hover:bg-muted transition-colors duration-[120ms]`, `aria-label="Back"`, calls `handleClose` (same as X) ✓
  - Header layout: `[Back][Title][shortcuts][Close]` ✓
  - `handleClose` triggers `setShowDiscard(true)` when draft is dirty ✓

---

## Item 13 — Calendar revalidation after schedule mutation

- PR: #984 (merged SHA 6f316cd1) + #987 (merged SHA ad65677)
- Files changed: `components/social/composer/ComposerOverlay.tsx`
- Spec compliance: **PASS**
- Evidence:
  - `ComposerOverlay.tsx:229-232` — after successful POST: `swrMutate((key) => typeof key === "string" && key.includes("/api/platform/social/drafts/calendar-view"))` — revalidates all mounted useCalendarView subscriptions ✓
  - `ComposerOverlay.tsx:171-173` — same revalidation after convert-to-draft ✓
  - Both CalendarShell and MonthCalendar subscribe to `useCalendarView` via SWR; both revalidate on the same mutate call ✓

---

## Item 14 — Unsaved-changes dialog rewrite

- PR: #984 (merged SHA 6f316cd1)
- Files changed: `components/social/composer/UnsavedChangesDialog.tsx`
- Spec compliance: **PASS**
- Evidence:
  - `UnsavedChangesDialog.tsx:37` — `<DialogTitle>Do you want to save your changes?</DialogTitle>` ✓
  - No body copy (no `<DialogDescription>`) ✓
  - `UnsavedChangesDialog.tsx:41-50` — Save button (primary emerald) ✓
  - `UnsavedChangesDialog.tsx:51-57` — Continue editing (secondary/border) ✓
  - `UnsavedChangesDialog.tsx:58-65` — Don't save (tertiary/text-muted-foreground) ✓

---

## Item 15 — Click routing by post status

- PR: #987 (merged SHA ad65677)
- Files changed: `components/social/dashboard/CalendarShell.tsx`, `components/composer/composer-mount-v2.tsx`, `components/social/composer/ComposerOverlay.tsx`
- Spec compliance: **PASS**
- Evidence:
  - `CalendarShell.tsx:175-183` — `handleClickPost`: `published` → `setAnalyticsPostId(post.id)` (analytics modal); all others → `router.push("?compose=" + post.id)` ✓
  - `composer-mount-v2.tsx:146-151` — draft fetch populates `editOriginalState` + `failureReason` from API response ✓
  - `ComposerOverlay.tsx:319` — `isPublishing = editOriginalState === "publishing"` → `pointer-events-none opacity-60` on content area ✓
  - `ComposerOverlay.tsx:478-486` — `failed` state shows failure banner with retry context ✓

---

## Item 16 — cursor-pointer on clickable chips and side-rail cards

- PR: #984 (merged SHA 6f316cd1)
- Files changed: `components/social/dashboard/PostChip.tsx`, `components/social/dashboard/DayDetailPostCard.tsx`, `components/social/calendar/DayCell.tsx`
- Spec compliance: **PASS**
- Evidence:
  - `PostChip.tsx:91` — `cursor-pointer` in className ✓
  - `DayDetailPostCard.tsx:88-90` — outer div has `cursor-pointer` ✓
  - `DayCell.tsx:49` — `cursor-pointer` in className ✓

---

## Item 17 — Edit-mode header "Edit post for [icon] [name] · Failed"

- PR: #987 (merged SHA ad65677)
- Files changed: `components/social/composer/ComposerOverlay.tsx`
- Spec compliance: **PARTIAL**
- Evidence:
  - `ComposerOverlay.tsx:393-410` — "Edit post for" + `SocialPlatformIcon` + account_name + "· Failed" ✓
  - `ComposerOverlay.tsx:398` — `SocialPlatformIcon size={16}` — **spec requires 24px brand icon** ✗
  - `text-destructive` on "· Failed" suffix ✓
  - Multi-profile truncation with "…" ✓
- Notes: Icon size 16px vs spec's 24px. Fixed in gap-fix PR.

---

## Item 18 — Convert-to-draft button + endpoint

- PR: #987 (merged SHA ad65677)
- Files changed: `components/social/composer/ComposerOverlay.tsx`, `app/api/platform/social/drafts/[id]/convert-to-draft/route.ts`
- Spec compliance: **PASS**
- Evidence:
  - `app/api/platform/social/drafts/[id]/convert-to-draft/route.ts` — POST endpoint, requires scheduled state, sets state='draft' + scheduled_at=NULL, auth gate ✓
  - `ComposerOverlay.tsx:351-360` — `editOriginalState === "scheduled"` → renders Convert-to-draft button ✓
  - `ComposerOverlay.tsx:164-178` — `handleConvertToDraft` calls endpoint + SWR revalidation + onClose ✓

---

## Item 19 — Calendar chip content-type indicators

- PR: #985 (merged SHA f14bf402)
- Files changed: `components/social/dashboard/PostChip.tsx`, `app/api/platform/social/drafts/calendar-view/route.ts`, `lib/social/types.ts`
- Spec compliance: **PASS**
- Evidence:
  - `PostChip.tsx:85-86` — `hasMedia = primary_media_url !== null`, `hasLink = !hasMedia && link_url !== null` (media precedence) ✓
  - `PostChip.tsx:105` — `{hasMedia && <Image size={12} className="shrink-0 text-muted-foreground" />}` ✓
  - `PostChip.tsx:106` — `{hasLink && <Link2 size={12} className="shrink-0 text-muted-foreground" />}` ✓
  - `calendar-view/route.ts:51,81` — `link_url` column selected + mapped ✓
  - `lib/social/types.ts:56` — `link_url: string | null` in CalendarPost ✓

---

## Item 20 — Edit-mode cell highlight in composer Calendar tab

- PR: #985 (merged SHA f14bf402)
- Files changed: `components/social/calendar/DayCell.tsx`, `components/social/calendar/MonthCalendar.tsx`, `components/social/dashboard/PostChip.tsx`
- Spec compliance: **PARTIAL**
- Evidence:
  - `DayCell.tsx:34` — `hasCellHighlight = highlightPostId ? posts.some(p => p.id === highlightPostId) : false` ✓
  - `DayCell.tsx:54` — `hasCellHighlight && !isSelected && "border-2 border-emerald-500 bg-emerald-50/60"` ✓
  - `PostChip.tsx:92` — `highlighted && "ring-2 ring-emerald-500"` ✓
  - `MonthCalendar.tsx:201-214` — passes `highlightPostId` to `DayCell` ✓
  - **MISSING**: `ComposerOverlay.tsx:563-566` — MonthCalendar rendered without `highlightPostId` prop ✗
- Notes: Infrastructure complete; ComposerOverlay needs `highlightPostId={initialDraft?.id}` passed to MonthCalendar. Fixed in gap-fix PR.

---

## Item 21 — OG metadata rehydrate on edit-mode open

- PR: #987 (merged SHA ad65677)
- Files changed: `components/social/composer/ContentEditor.tsx`
- Spec compliance: **PASS** *(fresh-fetch path — see notes)*
- Evidence:
  - `ContentEditor.tsx:63-103` — URL detection effect on `value` change; debounce 250ms; fires on composer open because `value = initialDraft.content` is non-empty ✓
  - User opens existing post with URL → link preview appears within ~250ms, no re-paste required ✓
  - Spec's fallback: "If OG fields are NULL but `link_url` is present → trigger fresh fetch on open" — implemented ✓
- Notes: Primary cached-data path (stored OG fields in DB) not implemented — no `link_og_title`/`link_og_image` columns exist in `social_post_drafts`; adding them requires schema changes which are prohibited this round. Current behavior satisfies the user-facing requirement (preview renders on open). Deferred to next round with schema.

---

## Summary

| # | Item | Status |
|---|---|---|
| 7 | Schedule button disabled tooltip | **PASS** |
| 8 | Profile chip hover hint | **PASS** |
| 9 | Chip overlay sizes 24/32px | **PASS** |
| 10 | Unified MonthCalendar | **PARTIAL** → gap-fix PR |
| 11 | Close button 32px/X-20px | **PASS** |
| 12 | Back button 32px/ChevronLeft | **PASS** |
| 13 | Calendar revalidation | **PASS** |
| 14 | Unsaved-changes dialog rewrite | **PASS** |
| 15 | Click routing by post status | **PASS** |
| 16 | cursor-pointer on chips/cards | **PASS** |
| 17 | Edit-mode header icon size | **PARTIAL** → gap-fix PR |
| 18 | Convert-to-draft button + endpoint | **PASS** |
| 19 | Content-type chip indicators | **PASS** |
| 20 | Edit-mode cell highlight | **PARTIAL** → gap-fix PR |
| 21 | OG metadata rehydrate | **PASS** (fresh-fetch path) |

**12/15 PASS immediately. 3 items need gap fixes (10, 17, 20).**
