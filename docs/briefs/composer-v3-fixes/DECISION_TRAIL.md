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

---

## PR-A2 — Preview card max-width (2026-05-21)

*Decision log entries TBD when PR-A2 is built.*

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
