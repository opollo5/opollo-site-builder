# Opollo Design Backlog Package

This bundle contains **two parallel design workstreams**. They are independent — neither blocks the other. Read whichever you are picking up.

## Workstream A — Composer rebuild
Visual + structural reference for the social composer rebuild. See sections below ("Wireframe Reference Pack").
**Status:** Spec v1.3 + wireframes shipped; awaiting director sign-off on the 5 open questions in `Scheduling_Proposal.md` §13.

## Workstream B — Frontend template framework
Pass 1 proposal that collapses the 82-route audit (80 cluster IDs) into 16 named templates.
**Status:** Awaiting director sign-off on the 11 framework-level decisions in `Frontend_Template_Framework_Pass_1.md` §1 before Pass 2 per-template specs begin.

**Files for Workstream B:**
- `Frontend_Template_Framework_Pass_1.md` — source markdown
- `Opollo_Frontend_Template_Framework_Pass_1.docx` — Word version for circulation

The two workstreams will eventually intersect — the composer rebuild is *inside* T-DETAIL-TABBED (cluster T-detail-tabbed-standard-IA in the audit). Pass 2 of the template framework will reference the composer wireframes as the canonical T-DETAIL-TABBED implementation.

---

# Workstream A — Social Composer Wireframe Reference Pack

These wireframes are a visual + structural reference for Claude Code to implement the composer rebuild specified in **Opollo Composer Parity Spec v1.3** (in this same bundle).

They are **not** production code. They are reference UIs in plain HTML + CSS so the visual layout, button placement, sizing, and interaction patterns are unambiguous when Claude Code rebuilds them in React/Next.js inside `app/(platform)/social/poster/`.

---

## What's in here

| File | Purpose | Spec section in v1.3 |
|---|---|---|
| `tokens.css` | Design tokens — colors, type, spacing, radii, shadows, motion | §2 Design tokens |
| `styles.css` | Component layer — buttons, calendar, composer, modals, callouts | §2 Design tokens, §3–§7, §13–§16 |
| `sprite.js` | Shared SVG icon library (UI icons + platform brand marks) | — |
| `interactions.js` | Tab switching, modal close, dirty-state, drag-and-drop scaffolding | §11 Behaviour |
| `build.js` | Generator script that builds the composer + modal pages from shared partials | — |
| `00-dashboard-empty-state.html` | Calendar with the "Connect a Social Profile" callout — empty state | §13.7 Empty state |
| `01-dashboard-populated.html` | Calendar with scheduled posts + day-detail right panel | §13.1–§13.6 |
| `02-composer-idle.html` | Composer open, no profile selected, preview empty | §3, §3a |
| `03-composer-with-content.html` | LinkedIn selected, content entered, LinkedIn preview card | §3.1, §3a.2 |
| `04-composer-multi-platform.html` | LinkedIn + GBP selected, "Customize for" row, per-platform action affordances | §5.4, §5.5 |
| `05-composer-schedule.html` | Schedule tab active — date+time picker, Add time, approval toggle | §7.1 |
| `06-composer-publish-regularly.html` | Publish-regularly tab — recurrence picker (every N weeks until date) | §7.2 |
| `07-composer-save-as-draft.html` | Save-as-draft tab — planned-for-at picker | §7.3 |
| `08-composer-unsaved-modal.html` | Unsaved-changes confirm modal (Save / Continue editing / Don't save) | §3.3 |
| `09-bulk-csv-modal.html` | Bulk CSV upload — empty state with illustration + Upload CSV button | §14 |
| `09a-bulk-csv-uploaded.html` | Bulk CSV upload — file uploaded with error preview table | §14.3 |
| `10-post-analytics-modal.html` | Click published post → analytics modal with metrics + post info | §15 |
| `11-add-profile-dropdown.html` | Two-stage dropdown showing connect options for all platforms | §13.2 |

---

## App shell (critical)

The topbar + left sidebar **is one component** used on every Opollo page. Every wireframe in this bundle uses the same shell markup with the same class names. Claude Code should implement this as `components/platform/AppShell.tsx` and import it from every page:

```tsx
<AppShell activeSection="social-poster">
  {/* page content */}
</AppShell>
```

If pages in the current codebase render different shells, that is a pre-existing bug worth fixing in a dedicated PR **before** this spec ships — otherwise it will inherit and entrench the inconsistency.

**Dimensions locked:**
- Topbar height: **56px**, sticky to viewport top, z-index 50
- Sidebar width: **240px** expanded / **64px** collapsed, full-height, sticky at z-index 49
- Content area: remaining viewport, max-width 1440px, padding 24px 32px

---

## Class-naming convention

These wireframes use **clean BEM-ish class names**, not the generated hash-based class names from any source UI. The convention is:

- Block: `.composer`
- Element: `.composer__pane`
- Modifier: `.composer__pane--right`

When Claude Code rebuilds, **each class name maps 1:1 to a React component or styled-component**. Example:

```html
<div class="composer-overlay">
  <div class="composer__pane composer__pane--left">…</div>
</div>
```

→

```tsx
<ComposerOverlay>
  <ComposerPane side="left">…</ComposerPane>
</ComposerOverlay>
```

---

## Brand tokens (locked, do not change)

| Token | Value | Use |
|---|---|---|
| `--color-brand-primary` | `#FF03A5` | Primary buttons, active states, today-marker, focus rings |
| `--color-brand-green` | `#00E5A0` | Success state, "new" badges, secondary CTA accent |
| `--color-callout-bg` | `#FFF4D6` | Empty-state callouts (the "Connect a Social Profile" tooltip) |
| `--font-display` | EmBauhausW00 | All page titles, modal titles, card titles |
| `--font-body` | Inter | Everything else |

Empty-state callouts deliberately use **warm yellow** (not pink) so they read as helpful, not as warnings. The CTA inside the callout is **black** (not pink) to keep visual hierarchy: yellow card frames the message, black CTA drives action without competing with the primary `#FF03A5` used elsewhere on the page.

---

## Scheduling — how the four tabs differ

The composer has **four scheduling modes**, each rendered as a tab in the scheduling-card. These are visible in wireframes 05–07 (and the `09-bulk-csv` modal for bulk equivalents):

| Tab | Behaviour | Submit button label | Database state |
|---|---|---|---|
| Post now | Publish immediately, optionally with approval gate | "Post now" | `state='publishing'`, then `'published'` |
| Schedule | One or more date+time pairs | "Schedule post" | `state='scheduled'`, `scheduled_at` set |
| Publish regularly | Recurring cadence (every N hours/days/weeks/months until date or no end) | "Save schedule" | `state='recurring'`, first 6 occurrences pre-generated as `'scheduled'` |
| Save as draft | No publish, optional planned-for-at hint | "Save draft" | `state='draft'`, `planned_for_at` optional |

**Approval workflow** is orthogonal — the toggle inside each tab adds a layer where the post goes to `state='pending_approval'` until the assigned approver acts. Default ON for the Agency tier per CLAUDE.md.

**Why this matters for Claude Code**: do **not** model these as four separate UI flows. They are four tabs on **one** scheduling-card that share the same submit handler. The handler reads `activeTab` and dispatches to the appropriate state machine transition. See spec §7 for the full state diagram.

---

## What Claude Code should do with this bundle

1. Read `Opollo_Composer_Parity_Spec_v1.3.docx` (in this same bundle) end to end.
2. Read `Scheduling_Proposal.md` (in this same bundle) — it expands §7 of the spec with the full scheduling logic, state machine, and edge cases.
3. Open each wireframe in a browser. Inspect with devtools. The class names you see are the class names to use.
4. Implement `AppShell` first — it is referenced by every page.
5. Implement the dashboard (00 + 01) before the composer (02–08) — the dashboard wraps the composer and surfaces its empty state.
6. Implement the composer in the build order from spec §11 (PR A → PR H).
7. **Do not invent new visual patterns.** If something is missing from these wireframes, raise it as a question rather than improvising — there is almost certainly a reason it is missing (the spec said "Phase 2" or "non-goal").

---

## What is intentionally NOT here

Per spec §0.5 (non-goals), these wireframes do not show:
- Mobile composer (Phase 2, separate spec)
- Multi-image carousel posts (Phase 2)
- A/B variant testing UI (Phase 3)
- CAP automation feed (separate module — `lib/cap/`, not the composer)

If you need these patterns, do not extrapolate from the wireframes — they are not here on purpose.

---

## Open visual decisions for Steven to confirm

These were left in the wireframes as my best guess; flag them on review if they should change:

1. **Sidebar collapsed state** — current shell shows expanded only. Should the sidebar collapse to 64px on screens < 1280px, or stay 240px and let the content shrink? My recommendation: stay 240px on desktop, collapse on tablet (< 1024px).
2. **Callout dismissal persistence** — the X currently dismisses for session only. Should it persist per-user (cookie)? Recommendation: session only, so people who connect later see the success state on next visit.
3. **Customize-for chip selection** — wireframe 04 shows LinkedIn highlighted in the chip row. Does clicking the chip swap the content in the editor (so each platform has its own draft), or open a separate sub-editor? Recommendation: swap the content (simpler, matches spec §5.5).
