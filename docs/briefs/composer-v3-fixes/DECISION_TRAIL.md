# Decision Trail — Composer v3 Fixes

Autonomous decisions logged here. D-044+ per master prompt operating rules.
Continues from `docs/briefs/social-composer-v3-rebuild/DECISION_TRAIL.md` (D-001–D-043).

---

## PR-A1 — Tool panels as Popovers (2026-05-21)

**D-044**: Radix Popover dependency already installed
- `grep '"@radix-ui/react-popover"' package.json` → `"@radix-ui/react-popover": "^1.1.15"` ✓
- Decision: Use `@radix-ui/react-popover` directly. No new dependency needed.

**D-045**: `--c3-z-popover` token not defined
- `globals.css` defines `--c3-z-overlay: 900` and `--c3-z-modal: 1000`, but not `--c3-z-popover`.
- Design spec (`00-design-tokens.md §11`) specifies `--z-popover: 200`.
- Decision: Use Tailwind arbitrary `z-[200]` on `PopoverContent` per spec. Log here per brief instructions. No new token added (existing `--c3-z-*` tokens set was not updated mid-PR).

**D-046**: Popover Portal → body; existing tests updated to use `page.getByTestId`
- `<Popover.Portal>` portals content to `document.body`.
- `dialog.getByTestId("composer-panel-{id}")` in `composer-tool-panels.spec.ts` would miss portaled elements.
- Decision: Update the 8 `toBeVisible()` / `not.toBeVisible()` assertions in that spec from `dialog.getByTestId` → `page.getByTestId`. The `not.toBeVisible()` assertions already pass either way (element absent from dialog subtree), but `toBeVisible()` assertions would fail without this change.
- `composer.spec.ts` line 185 and `composer-keyboard-shortcuts.spec.ts` already use `page.getByTestId` — no change needed.

**D-047**: Existing `useEffect` document listeners removed
- ToolsRow had two `useEffect` hooks: one for `document.addEventListener("keydown")` (Esc) and one for `document.addEventListener("pointerdown")` (click-outside).
- Radix's `DismissableLayer` (used inside `<Popover.Root>`) handles both Esc and pointer-outside automatically, calling `onOpenChange(false)`.
- Decision: Remove both `useEffect` hooks. Radix's behavior covers all cases.
- Removed `containerRef` too — no longer needed since click-outside is handled by Radix.

**D-048**: Mutual exclusion via controlled `open` + `onOpenChange`
- Each tool button uses `<Popover.Root open={activePanel === tool.id} onOpenChange={(open) => setActivePanel(open ? tool.id : null)}>`.
- When user clicks tool B while tool A is open: Radix's DismissableLayer fires `onOpenChange(false)` for A (pointerdown capture) before the click handler for B fires `onOpenChange(true)`. React 18 batches both state updates; result is `activePanel = "b"`. ✓

**D-049**: `max-h-[calc(100vh-100px)] overflow-y-auto` on PopoverContent
- CI e2e run 1 failure: UT-3 and UT-4 failed with "element is not stable" (30s timeout). First fix attempt: `avoidCollisions={false}`. That stopped the oscillation but exposed the underlying cause — the full error log from run 2 showed "element is outside of the viewport". The UTM panel is ~350px tall. When the trigger is at Y≈450px in a 720px viewport, the panel bottom lands at ~808px — outside the viewport. `position: fixed` portaled elements cannot be scrolled into view by Playwright.
- Decision: Remove `avoidCollisions={false}` (restore Radix flip behavior) and add `max-h-[calc(100vh-100px)] overflow-y-auto` to PopoverContent. The bounded max-height prevents both side from overflowing simultaneously — Radix can always find a valid side (above or below) that fits, eliminating the oscillation. When flipped to `side=top`, the panel bottom is at Y≈442px and top at Y≈92px — all elements within viewport.
- UT-5 (close button at top of panel) passed even without the fix because it's positioned just below the trigger — within the viewport — while the toggle and insert button at the panel's lower half were outside the viewport.

---

## PR-A2 — Preview card max-width (2026-05-21)

**D-050**: `max-w-[480px] mx-auto` on PreviewCard wrapper div
- PreviewCard.tsx line 93 — the outer `<div>` had only `space-y-2` + optional className. No width constraint. Cards stretched to fill the right-pane container (`flex-1`), which grows with the dialog width.
- Decision: Add `max-w-[480px] mx-auto` to the PreviewCard wrapper. `mx-auto` centers the card in the pane when the pane is wider than 480px. Applied at the PreviewCard layer (not at ComposerOverlay) so the constraint is co-located with the component and applies to all usages (composer right pane + analytics modal).
- `480px` is not an existing Tailwind token; using arbitrary value `max-w-[480px]`. The design-tokens unit test only checks sub-16px font sizes and hex colors — not flagged.

---

## PR-A3 — Profile chip sizing (2026-05-21)

*Decision log entries TBD when PR-A3 is built.*

---

## PR-B1 — AI assistant error categorization (2026-05-21)

*Decision log entries TBD when PR-B1 is built.*

---

## PR-C1 — Media library scope (2026-05-21)

*Decision log entries TBD when PR-C1 is built.*

---

## PR-C2 — Calendar month grid (2026-05-21)

*Decision log entries TBD when PR-C2 is built.*
