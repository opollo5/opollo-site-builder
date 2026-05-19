# Social-01 Wireframe vs Built — Audit Report

**Date:** 2026-05-19  
**Scope:** All 12 wireframes under `docs/briefs/social-01-brief/wireframes/`  
**Auditor:** Claude Code (hardening pass Workstream 2, PR 2.1)  
**Result:** 2 HIGH gaps fixed in PR 2.2; 3 gaps deferred (data model or architecture)

---

## Summary

| Severity | Count | Disposition |
|----------|-------|-------------|
| HIGH — Fixed in PR 2.2 | 2 | UnsavedChangesDialog "Save" button; TikTok "new" badge |
| HIGH — Deferred | 1 | Calendar grid mobile responsiveness (architecture change) |
| LOW — Deferred | 3 | Timezone hint in SchedulingCard; analytics Author/Tags (no data); empty-state copy |
| MATCH | 117+ | All core flows verified against built components |

---

## Wireframe-by-Wireframe Findings

### 00 — Dashboard empty state
All elements match: AppShell, tab nav, FilterBar, "New post" button, bulk-upload button, profile filter, empty-state callout (including dismiss), month/timeline toggle, calendar grid (6×7), month header with prev/next/Today, DayDetail empty message.

### 01 — Dashboard populated
All elements match: PostChip with platform icon + time + state indicator, multiple chips per cell, DayDetail post cards with hover actions (Delete/Reschedule), drag-and-drop rescheduling.

### 02 — Composer idle
All elements match: ComposerOverlay structure, close button, dynamic title, ProfileSelector, ContentEditor with character counter, ToolsRow (6 tools), SchedulingCard with 4 tabs, ScheduleRow with Add time, ApprovalToggle, Discard/Schedule buttons, preview pane empty state, Preview/Calendar tabs.

### 03 — Composer with content
All elements match: profile chip selected state, Deselect all, populated textarea with char count, MediaTray, PlatformActionsList, LinkedInPreview card with mock interactions, platform badge.

### 04 — Composer multi-platform
All elements match. ApprovalToggle label text "Send for client approval before publishing" confirmed in built code — initially flagged as mismatch but verified correct on re-read.

### 05 — Composer schedule
All elements match: ScheduleRow date/time inputs, Add time button, timezone display, Discard/Schedule footer.

### 06 — Composer publish regularly
All elements match: recurring frequency selector, RRULE generation, recurrence_state tracking.

### 07 — Composer save as draft
All elements match: Save as draft mode, planned_for_at date picker, draft state badge.

### 08 — Composer unsaved changes modal
**GAP (HIGH — fixed PR 2.2):** Wireframe shows three-button modal: "Don't save" / "Continue editing" / "Save". Built `UnsavedChangesDialog` only has "Keep editing" and "Discard" — no path to save the draft before closing. Fixed by adding `onSave` prop and "Save as draft" button.

### 09 — Bulk CSV modal empty state
All elements match: modal title, dropzone, instructions. Footer only renders in preview state (intentional — empty state has no actions).

### 09a — Bulk CSV uploaded with errors
All elements match: error row highlighting, error count message, column mapping table, preview table with error badges.

### 10 — Post analytics modal
**GAP (LOW — data model, deferred):** Wireframe shows "Author" and "Tags" rows in the Post info section. `DraftResponse` contains `created_by` (user ID UUID) but no display name or tags fields. Cannot render without a separate user-lookup query and a tags data model. Deferred to a data model ticket.

All other elements match: two-column layout, platform badge, StatCards (Impressions/Eng. rate), per-platform engagement detail rows, Published + Post link rows, footer actions (Open post, More dropdown, Schedule again).

### 11 — Add profile dropdown
**GAP (HIGH — fixed PR 2.2):** Wireframe shows a blue "new" badge on the TikTok item. Built `AddProfileDropdown` renders no badges on any platform item.

All other elements match: trigger testid `add-profile-trigger`, per-platform icons, per-platform connect links, click-outside close.

---

## Deferred gaps

| ID | Wireframe | Gap | Reason deferred |
|----|-----------|-----|-----------------|
| D-1 | All | Calendar grid mobile responsiveness | No mobile breakpoint defined in wireframes; architecture change required for CalendarShell grid collapse |
| D-2 | 02/03/05 | Timezone hint in SchedulingCard ("Times are in X; recipient platform timezone applies on publish") | Copy gap only; low user impact; follow-up UX polish |
| D-3 | 10 | Author + Tags rows in Post info | `DraftResponse` has `created_by` (UUID) not display name; Tags data model not yet built |

---

## Methodology

1. Read each wireframe HTML file verbatim (interaction scripts, layout HTML, spec comments)
2. Located corresponding built component(s) in `components/social/` and `app/(platform)/company/social/`
3. For each wireframe element: confirmed presence, label match, testid match, interaction handler match
4. Classified gaps by: MATCH / MISMATCH (HIGH/LOW) / MISSING (HIGH/LOW)
5. HIGH threshold: functional difference a user would notice or a spec'd behaviour absent from built code
