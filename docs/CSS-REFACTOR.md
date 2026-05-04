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

## Phase 3 — Replace hardcoded hex colours in UI components

**PR:** (pending)
**Date:** 2026-05-05
**Branch:** feat/css-design-system-phase-3

### Changes

- `tailwind.config.ts` — added `pk2` and `gr2` to the color token aliases
- `components/ui/button.tsx` — replaced `from-[#FF03A5] to-[#cc0084]` → `from-pk to-pk2`; hover colours → `border-gr`, `text-gr`, `text-pk`
- `components/AdminSidebar.tsx` — replaced all `#FF03A5`, `#00e5a0`, `#07070f`, `#04040a` with `bg-pk`, `text-gr`, `hover:text-gr`, `ring-gr`, `ring-offset-d1`, gradient `var(--d1)…var(--bg)`
- `components/optimiser/ScoreSparkline.tsx` — replaced Tailwind color values with `var(--gr)`, `var(--am)`, `var(--rd)` to align sparkline colours with the Opollo design system

### Intentional exceptions (kept as hex)

- `lib/design-discovery/industry-defaults.ts` — *client site* color presets (not admin UI tokens)
- `lib/copy-existing-extract.ts` — fallback for extracted client site colors
- `lib/design-discovery/extract-css.ts` — white/black filter comparisons
- `app/api/platform/image/generate/route.ts` — fallback for brand color API
- `e2e/*.spec.ts` — test fixture data
- Form `placeholder` values showing example hex format
- `app/api/admin/email-test/route.ts` — email HTML template color (resolved in Phase 5)

---

## Phase 4 — Replace arbitrary rgba colour values with token aliases

**PR:** (pending)
**Date:** 2026-05-05
**Branch:** feat/css-design-system-phase-4

### Changes

- `tailwind.config.ts` — added `m1`/`m2`/`m3`/`m4` (white opacity text tokens) and `b1`/`b2`/`b3` (rgba border tokens) to Tailwind color aliases
- `components/AdminSidebar.tsx` — replaced `text-[rgba(255,255,255,0.58)]` → `text-m2`, `text-[rgba(255,255,255,0.32)]` → `text-m3`, `hover:bg-[rgba(255,255,255,0.06)]` → `hover:bg-b1`

### Intentional exceptions (kept as arbitrary values)

- `text-[rgba(255,255,255,0.40)]` — no exact token; between `--m3` (0.32) and `--m2` (0.58); used for inactive icon color
- `bg-[rgba(255,3,165,0.10)]` — active nav item bg; `--pk-soft` is 0.12 (different); left as-is
- `bg-[rgba(4,4,10,0.85)]` — mobile topbar at 85% opacity; no token
- `hover:bg-[rgba(0,229,160,0.06)]` — nav hover bg; `--gr-soft` is 0.10 (different); left as-is
- `hover:bg-[rgba(0,229,160,0.08)]` in button.tsx — ghost hover bg; no exact token

---

## Phase 5 — Inline styles audit and cleanup (pending)

---

## Phase 6 — Lint enforcement (pending)
