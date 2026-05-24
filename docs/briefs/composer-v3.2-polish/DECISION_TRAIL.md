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

**D-071**: Chip tooltip e2e trigger strategy
- `hover()` on a `<button>` trigger in headless Chromium doesn't reliably trigger Radix Tooltip's portal mount (Radix lazily mounts portal content on first show).
- `focus()` is reliable: Radix Tooltip shows instantly on keyboard focus (bypasses `delayDuration`).
- D1-2 test updated to use `focus()` + `data-testid="chip-tooltip-{id}"` (set on TooltipContent) instead of hover + `[role="tooltip"]`.
- D1-1 (submit button tooltip) used `hover()` on a `<span>` trigger and passed — button vs span trigger behaves differently in headless Chromium.

---

## PR-D3 — Edit-mode header + Convert-to-draft + OG rehydrate (2026-05-21)

*Decision log entries TBD.*

---

## P0 — AI assist production failure (2026-05-22)

**D-072**: Root cause diagnosis — Anthropic billing/credit exhaustion
- Trace_id `ai-gen-bd69-6056` could not be found in `client_errors` (table doesn't exist — migrations 0140/0141 not applied).
- Direct Anthropic API call with the production API key returned HTTP 400: `"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."`
- Confirmed: the assist route already uses `defaultAnthropicCall` from `lib/anthropic-call.ts` (canonical client, NOT a parallel implementation). No architecture change needed.
- Root fix: Steven must add credits at `console.anthropic.com/settings/billing`.

**D-073**: Error categorization improvement (#992)
- Previous: `BadRequestError` → `invalid_request` / "Something went wrong with your request" — user-blaming for a billing failure.
- Fix: check `err.message` (SDK formats as `"${status} ${JSON.stringify(errorBody)}"`) for "credit balance" or "billing" keywords → route to `unknown/SERVICE_UNAVAILABLE` / "AI generation is temporarily unavailable."
- Did NOT use `overloaded` category because ToolsRow auto-retries `category === "overloaded"` 3 times — billing errors are not retryable.
- Also added `code` and `http_status` to `cap.assist.claude_failed` log so future 400s are diagnosed immediately.

**D-074**: Missing `client_errors` table
- Migrations `0140_add_client_errors.sql` and `0141_client_errors_resolved_at.sql` exist but were never applied.
- `POST /api/errors` silently eats the insert error and returns 201 — client never knows logging failed.
- Cannot apply via Supabase CLI (no login token, Docker not running for diff).
- Manual step for Steven: apply both migrations in Supabase Dashboard → SQL Editor.
