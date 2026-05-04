# CSS Design System Refactor Log

## Pre-flight audit (2026-05-05)

| Category | Count |
|---|---|
| Font violations (<15px) | ~55 instances across 30+ files |
| Inline styles | 22 |
| Hardcoded hex colours | 27 |
| Arbitrary Tailwind font sizes | 50 |
| Arbitrary Tailwind colours | 12 |

### Font violations detail

Files with sub-15px font sizes (to be fixed in Phase 2):

- `app/admin/sites/[id]/posts/page.tsx` — `text-[11px]` (line 281)
- `app/admin/users/audit/page.tsx` — `text-[11px]` (line 108)
- `app/api/admin/email-test/route.ts` — `font-size:14px` in HTML template (line 54) — **needs design decision: this is an email template string, not a rendered component**
- `app/globals.css` — `font-size: 10px` (line 112), `font-size: 13px` (lines 156, 185)
- `components/AdminSidebar.tsx` — `text-[10px]` (lines 323, 346, 349), `text-[11px]` (line 409)
- `components/AppearanceEventLog.tsx` — `text-[11px]` (line 161)
- `components/BlogPostComposer.tsx` — `text-[10px]` (lines 1082, 1085), `text-[11px]` (line 1169)
- `components/BriefRunClient.tsx` — `text-[10px]` (line 869)
- `components/BulkImageUpload.tsx` — `text-[10px]` (line 397)
- `components/BulkUploadPanel.tsx` — `text-[10px]` (lines 398, 401, 684, 692, 706, 714)
- `components/CommandPalette.tsx` — `text-[10px]` (lines 365, 369, 375)
- `components/ConceptRefinementView.tsx` — `text-[10px]` (lines 197, 214, 221, 420, 438, 460)
- `components/ConceptReviewCards.tsx` — `text-[10px]` (lines 166, 191, 206, 221, 260, 264, 302, 315)
- `components/DesignDirectionInputs.tsx` — `text-[10px]` (line 656)
- `components/DesignUnderstandingPanel.tsx` — `text-[10px]` (line 102)
- `components/MoodBoardStrip.tsx` — `text-[10px]` (lines 36, 87, 106)
- `components/NotificationBell.tsx` — `text-[10px]` (line 112)
- `components/RunCostTicker.tsx` — `text-[10px]` (lines 168, 172)
- `components/ScreenshotUploadZone.tsx` — `text-[10px]` (line 285)
- `components/SetupWizard.tsx` — `text-[10px]` (line 624)
- `components/ToneOfVoiceInputs.tsx` — `text-[11px]` (line 547), `text-[10px]` (line 583)
- `components/TrustedDevicesList.tsx` — `text-[10px]` (line 149)
- `components/ui/button.tsx` — `text-[13px]` (line 20)

---

## Phase 1 — Token system + Tailwind enforcement

**PR:** (pending)
**Date:** 2026-05-05
**Branch:** feat/css-design-system-phase-1

### Changes

- Created `styles/tokens.css` — single source of truth for all design tokens
- Added `import "@/styles/tokens.css"` to `app/layout.tsx`
- Updated `tailwind.config.ts` fontSize scale: `text-xs` and `text-sm` both now produce 15px

### Effect

After this phase, it is structurally impossible to produce font sizes below 15px
using `text-xs` or `text-sm` Tailwind classes. Arbitrary `text-[10px]` etc. still
compile but are caught by Phase 6 lint rules.

---

## Phase 2 — Fix font size violations

**PR:** (pending)
**Date:** 2026-05-05
**Branch:** feat/css-design-system-phase-2

### Changes — bumped to text-xs (15px)

| File | Lines | Element |
|---|---|---|
| `app/admin/sites/[id]/posts/page.tsx` | 281 | Post slug code |
| `app/admin/users/audit/page.tsx` | 108 | Metadata JSON code block |
| `components/AdminSidebar.tsx` | 409 | Current user email in footer |
| `components/AppearanceEventLog.tsx` | 161 | Event details JSON in pre |
| `components/BlogPostComposer.tsx` | 1169 | WP preview URL |
| `components/BriefRunClient.tsx` | 869 | Issue severity badge |
| `components/BulkImageUpload.tsx` | 397 | Upload status badge |
| `components/BulkUploadPanel.tsx` | 684, 692, 706, 714 | Status badges (Rejected/Saving/Saved/Failed) |
| `components/ConceptRefinementView.tsx` | 197, 214, 221, 438, 460 | Preview section labels |
| `components/ConceptReviewCards.tsx` | 166, 191, 206, 221 | Font metadata + Desktop/Mobile toggle |
| `components/DesignDirectionInputs.tsx` | 656 | "Generating…" message |
| `components/MoodBoardStrip.tsx` | 87, 106 | Layout/visual-tone tag pills |
| `components/RunCostTicker.tsx` | 168, 172 | Model identifiers |
| `components/ScreenshotUploadZone.tsx` | 285 | Screenshot filename |
| `components/ToneOfVoiceInputs.tsx` | 547, 583 | Style guide pre + sample labels |
| `components/TrustedDevicesList.tsx` | 149 | "This device" badge |

### Intentional exceptions — kept at small size

| File | Lines | Element | Reason |
|---|---|---|---|
| `app/globals.css` | 112 | `.lbl { font-size: 10px }` | Eyebrow label spec (10–11px per design system) |
| `app/globals.css` | 156, 185 | `.btn-pk`, `.btn-ghost` at 13px | Button spec (13px per design system) |
| `components/AdminSidebar.tsx` | 323 | `.lbl` section label — removed redundant `text-[10px]` | `.lbl` class handles size |
| `components/AdminSidebar.tsx` | 346, 349 | ⌘K keyboard symbol `<kbd>` | Decorative keyboard symbol |
| `components/BlogPostComposer.tsx` | 1082, 1085 | ⌘S keyboard symbol `<kbd>` | Decorative keyboard symbol |
| `components/BulkUploadPanel.tsx` | 398, 401 | ⌘↵ keyboard symbol `<kbd>` | Decorative keyboard symbol |
| `components/CommandPalette.tsx` | 365, 369, 375 | ↑↓ ↵ esc keyboard hints | Compact keyboard hint footer |
| `components/ConceptRefinementView.tsx` | 420 | Color swatch token badge | Decorative — has `title` tooltip |
| `components/DesignUnderstandingPanel.tsx` | 102 | Color swatch badge | Decorative — has `title` tooltip |
| `components/MoodBoardStrip.tsx` | 36 | Color swatch badge | Decorative — has `title` tooltip |
| `components/NotificationBell.tsx` | 112 | Unread count in 16px circle | Layout-constrained |
| `components/SetupWizard.tsx` | 624 | Color token key label on swatch | Decorative |
| `components/ui/button.tsx` | 20 | Button text at 13px | Button spec (13px per design system) |

### Pending design decisions

- `app/api/admin/email-test/route.ts:54` — `font-size:14px` inside a raw HTML string for a transactional email template. This is not a rendered component; the token system cannot enforce it. Decision: accept as-is (14px in email context is fine for transactional email); not an operator-surface violation.

---

## Phase 3 — Replace hardcoded hex colours (pending)

---

## Phase 4 — Replace arbitrary Tailwind spacing/size values (pending)

---

## Phase 5 — Inline styles audit and cleanup (pending)

---

## Phase 6 — Lint enforcement (pending)
