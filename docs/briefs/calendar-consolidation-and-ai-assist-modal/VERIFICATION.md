# Verification Plan — Calendar Consolidation + AI Assist Modal
**Branch**: `fix/calendar-consolidation-and-ai-assist-modal`
**Date**: 2026-05-23

---

## Issues addressed

- **Issue 3**: Today date pill clipped at cell corner — padding increased to `p-2`, pill enlarged to `h-6 w-6`
- **Issue 4**: Today cell needs faint `bg-primary/5` tint — added to both DefaultCell and DnDCell
- **Issue 5**: Calendar component duplication — consolidated into `SocialCalendarGrid.tsx`; deleted MonthCalendar.tsx, DayCell.tsx, CalendarCell.tsx, SocialCalendarClient.tsx
- **Issue 6**: AI assist result panel overflows composer bounds — moved to `Dialog` (max-w-[600px])

---

## Proof 1 — Today pill has breathing room (Issue 3)

**Steps:**
1. Navigate to `/company/social/calendar`
2. Locate today's date cell

**Expected:**
- Today date number is inside a pill with visible padding around it on all sides
- Pill does not touch the cell corner
- Pill size is `h-6 w-6` (24px) — larger than the old `h-5 w-5` (20px)

---

## Proof 2 — Today cell has faint tint (Issue 4)

**Steps:**
1. Navigate to `/company/social/calendar`
2. Locate today's date cell

**Expected:**
- Today's cell has a visible faint `bg-primary/5` background tint
- Other non-selected cells do not have this tint
- When today's cell is selected, the `bg-primary/5` from selection overrides (no visual change)

---

## Proof 3 — Calendar page renders correctly (Issue 5 — page context)

**Steps:**
1. Navigate to `/company/social/calendar`
2. Verify month grid loads

**Expected:**
- `data-testid="calendar-grid"` present
- `data-testid="month-label"` shows current month/year
- Day cells have `data-testid="calendar-dnd-cell"` (DnD-aware cells)
- At least 28 cells rendered
- Post chips render on days with scheduled posts
- `data-testid="calendar-cell"` does NOT appear (old testid deleted)

---

## Proof 4 — Composer calendar tab renders correctly (Issue 5 — composer-pane context)

**Steps:**
1. Open the composer (`?compose=new` or click "New post")
2. Click the "Calendar" tab in the right pane

**Expected:**
- Month calendar renders inside the composer pane
- `data-testid="calendar-grid"` present
- Day cells have `data-testid="calendar-day-{date}"` (DefaultCell testids)
- Navigation arrows (Previous/Next month) work
- Existing scheduled posts appear as chips on their dates

---

## Proof 5 — DnD drag still works (Issue 5 — regression check)

**Steps:**
1. Navigate to `/company/social/calendar`
2. Drag a scheduled post chip from one day to another

**Expected:**
- Post moves to the target date (optimistic update)
- PATCH request fires to `/api/platform/social/drafts/{id}`
- Calendar re-renders with the post on the new date

---

## Proof 6 — cell-add-btn removed (Issue 5 — hard constraint)

**Steps:**
1. Navigate to `/company/social/calendar`
2. Hover over any future day cell

**Expected:**
- No `+` button appears on hover
- `data-testid="cell-add-btn"` does NOT exist anywhere in the DOM
- "New post" in FilterBar still works to open composer

---

## Proof 7 — AI assist opens as Dialog, not Popover (Issue 6)

**Steps:**
1. Open the composer
2. Click "AI assistant" in the tools row

**Expected:**
- AI panel opens as a centered Dialog overlay (not anchored to the button)
- Panel has max-width of 600px
- Panel is fully visible — does not overflow or clip at composer boundaries
- Clicking outside the dialog or pressing Esc closes it
- `data-testid="ai-panel"` is visible inside the dialog

---

## Proof 8 — AI assist panel functionality unchanged (Issue 6 — regression check)

**Steps:**
1. Open the composer
2. Click "AI assistant"
3. Enter a prompt (e.g. "Write a LinkedIn post about our new product launch")
4. Select goal/tone/length
5. Click "Generate"

**Expected:**
- Cost estimate visible below prompt field
- Generate fires POST `/api/platform/social/cap/assist`
- Result appears in the `data-testid="ai-result"` block
- "Use this text" button inserts text into composer and closes dialog

---

## Files changed

| File | Change |
|---|---|
| `components/social/calendar/SocialCalendarGrid.tsx` | **CREATED** — merged MonthCalendar + DayCell, Issues 3+4 |
| `components/social/dashboard/CalendarShell.tsx` | Import SocialCalendarGrid; inline DnDCell (testid `calendar-dnd-cell`) |
| `components/social/composer/ComposerOverlay.tsx` | Import SocialCalendarGrid |
| `components/social/composer/ToolsRow.tsx` | AI panel → Dialog (max-w-[600px]) |
| `components/social/calendar/MonthCalendar.tsx` | **DELETED** |
| `components/social/calendar/DayCell.tsx` | **DELETED** |
| `components/social/dashboard/CalendarCell.tsx` | **DELETED** |
| `components/SocialCalendarClient.tsx` | **DELETED** |
| `e2e/dashboard.spec.ts` | `calendar-cell` → `calendar-dnd-cell`; F-3 test removed |
| `e2e/composer-v3.2-full-flow.spec.ts` | `calendar-cell` → `calendar-dnd-cell` |
| `e2e/composer-v3.2-gap-fixes.spec.ts` | `calendar-cell` → `calendar-dnd-cell` |

---

*Results: PENDING — paste run output here after production deploy.*
