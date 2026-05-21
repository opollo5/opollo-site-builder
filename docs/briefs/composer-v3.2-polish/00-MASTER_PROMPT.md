# Composer v3.2 — Polish + Edit-Mode Parity Pack

**For:** `opollo5/opollo-site-builder`
**Audience:** autonomous Claude Code session
**Date:** 2026-05-21
**Predecessor:** composer-v3-fixes (PRs #977–#983, plus production migration 0142 applied 2026-05-21)

---

## What this is

Fifteen items surfaced during UAT after the composer-v3-fixes round shipped. Three categories:

1. **Affordances & micro-copy** — tooltips, button states, dialog rewording, cursors
2. **Sizing & navigation chrome** — close/back buttons, chip overlay sizes
3. **Calendar + edit-mode parity** — consolidate two calendar implementations, surface edit-state behaviors that match Semrush's pattern

Three PRs:

| PR | Scope | Branch | Est. time |
|---|---|---|---|
| **PR-D1** | Affordances + dialog + cursors + sizing | `polish/composer-affordances` | 1.5h |
| **PR-D2** | Calendar consolidation + edit-mode chips + cell-highlight | `feat/composer-calendar-unified` | 2h |
| **PR-D3** | Edit-mode header + Convert-to-draft + OG rehydrate | `feat/composer-edit-mode-parity` | 1.5h |

Total ~5 hours.

---

## Reference files

- `docs/briefs/social-composer-v3-rebuild/wireframes/00-design-tokens.md` — design tokens (do not edit)
- `docs/briefs/social-composer-v3-rebuild/wireframes/01-composer-states.html` — composer wireframes (do not edit)
- `docs/briefs/composer-v3-fixes/semrush-calendar.png` — Semrush calendar layout reference
- `docs/briefs/composer-v3.2-polish/calendar-chip-variants.svg` — chip variant spec for PR-D2
- `docs/briefs/composer-v3.2-polish/DECISION_TRAIL.md` — create if missing, pick up at D-051

---

## Global guardrails (same as v3 + v3-fixes)

- Sequential PRs, single session. Squash-merge each after CI + Vercel preview green.
- Every PR description includes production URL + screenshot proof against `https://opollo-site-builder.vercel.app`.
- Eight approved vendors only: bundle.social, Anthropic, Ideogram, SendGrid, Supabase, Vercel, Upstash Redis, GIPHY.
- New npm dependency? Halt and ask. State package, why, alternative, license.
- Existing design tokens only. No new colors, fonts, durations, radii.
- No schema changes this round. If a backlog item requires one, surface it and skip — don't expand scope.
- DECISION_TRAIL.md appended as you go, picking up D-051.

**Escalate to Steven for:** missing env var, schema change required, bundle.social API change, new npm dependency, 5h budget exhausted.

Everything else: decide, log, ship.

---

# PR-D1 — Affordances + dialog + cursors + sizing

**Branch:** `polish/composer-affordances`

Closes backlog items 7, 8, 9, 11, 12, 14, 16.

## Item 7 — Schedule button disabled-state hover tooltip

When the "Schedule post" / "Post now" button is in its disabled state because no profile is selected, hovering the button shows a tooltip:

> Select at least one account to post to

Use the existing Tooltip primitive (grep for existing tooltip usage in the codebase — likely Radix Tooltip or shadcn's wrapper). Tooltip appears after 300ms hover delay, dismisses on mouse-leave. Tooltip arrow points down at the button.

If the button is enabled, no tooltip.

## Item 8 — Profile chips hover hint when none selected

When zero profiles are selected and the user hovers any profile chip, show tooltip on the chip:

> Click to select

Same tooltip primitive. Same 300ms delay. Tooltip dismisses once at least one profile is selected (no longer needed once the user has shown they understand the pattern).

## Item 9 — Profile chip overlay sizes

The chip's overlays are undersized vs. the wireframe spec. Restore to:

- **Checkmark overlay** (top-left, shown when selected): currently 20×20px → bump to **24×24px**. White checkmark on emerald fill. Ring is 2px white.
- **Brand-platform icon overlay** (bottom-right, always shown): currently 24×24px → bump to **32×32px**. The brand icon component inside it (from `components/icons/social/`) stays at its native viewBox; only the overlay circle scales. Ring is 2.5px white.

Outer chip remains 56×56px. Avatar inset remains 52×52px. Only the two overlays change.

Spec these dimensions via CSS custom properties so they're easy to audit:

```css
--chip-overlay-checkmark: 24px;
--chip-overlay-brand: 32px;
```

## Item 11 — Top-right close button

The current X close icon in the composer overlay header is small and easy to miss. Replace with a larger, more obvious button at top-right of the overlay:

- 32×32px hit target
- Lucide `X` icon at 20px stroke-width 1.75
- Background: transparent default, `--ink-7` (subtle hover background) on hover, transition 120ms
- Positioned at top-right with 16px inset from the right edge
- Vertically centered with the "New post" / "Edit post for…" title
- aria-label="Close composer"

## Item 12 — Top-left Back button

Add a Back affordance at top-left of the overlay header. Same row as the title, before it. Behavior identical to clicking the X (triggers the unsaved-changes guard if applicable):

- Lucide `ChevronLeft` icon at 20px
- 32×32px hit target
- Same hover styling as the close button
- aria-label="Back"
- Renders to the LEFT of the title, with the title shifted right to accommodate

Layout in the header row, left-to-right: `[Back] [Title…………………………] [Close]`

## Item 14 — Unsaved-changes dialog rewrite

Current Opollo dialog:
- Title: "Unsaved changes"
- Body: "You have unsaved changes. Would you like to save as a draft before closing?"
- Buttons: Keep editing / Discard / Save as draft (primary)

Rewrite to match Semrush's tighter pattern:
- **Title:** "Do you want to save your changes?"
- **Body:** (remove entirely — title is the question)
- **Buttons** (left-to-right):
  1. **Save** — primary, emerald. Persists as draft and closes.
  2. **Continue editing** — secondary. Dismisses dialog.
  3. **Don't save** — tertiary/text style. Discards and closes.

The action mappings change too:
- "Save" → existing `saveAsDraft` handler + close overlay
- "Continue editing" → just close the dialog, leave composer open
- "Don't save" → discard draft state + close overlay

Keep the existing close-X on the dialog (it dismisses the dialog, equivalent to "Continue editing").

## Item 16 — Cursor on clickable post chips and side-rail cards

The side-rail day-detail panel post cards (and any calendar post chips) currently default to text cursor — users can't tell they're clickable.

Add `cursor: pointer` (or Tailwind `cursor-pointer`) to:
- Post chips inside calendar day cells (`PostChip` component from v3-fixes)
- Side-rail post cards on the calendar's day-detail rail
- Any other clickable post representation

One-line fix per component. Audit by grepping for components that render post data and verify each has explicit pointer cursor.

## PR-D1 verification

- Screenshot the composer with no profile selected, hovering the disabled Schedule button — tooltip visible
- Screenshot the composer with no profile selected, hovering a profile chip — tooltip visible
- Screenshot a selected profile chip — overlays clearly larger (24px checkmark, 32px brand)
- Screenshot the composer header showing Back-Title-Close layout
- Screenshot the unsaved-changes dialog with new copy + button order
- Verify cursor changes to pointer when hovering a side-rail post card (manual; mention in PR description)

## PR-D1 e2e

- Open composer with no profile selected
- Assert `[data-testid="schedule-button"]` is disabled
- Hover, wait 350ms, assert tooltip with "Select at least one account" is visible
- Click a profile chip, assert tooltip on chip disappears
- Click the Back button (top-left chevron), assert unsaved-changes dialog opens
- Assert dialog title is "Do you want to save your changes?"
- Assert button order: Save, Continue editing, Don't save
- Click "Continue editing", assert dialog closes, composer stays open

**PR title:** `polish(composer): tooltips, dialog rewrite, header chrome, cursors`

---

# PR-D2 — Calendar consolidation + edit-mode chips + cell-highlight

**Branch:** `feat/composer-calendar-unified`

Closes backlog items 10, 13, 19, 20.

## Item 10 — Unified MonthCalendar

The composer's right-pane Calendar tab currently uses a separate, simpler month-grid implementation. The main `/company/social/calendar` page has the full implementation with side-rail day-detail panel, Month/Timeline toggle, "Today" pill, and Add Profile dropdown.

Consolidate. The same `MonthCalendar` component (from PR #983) should render in both places. Differences between contexts handled via props, not divergent components:

```tsx
<MonthCalendar
  context="page" | "composer-pane"
  selectedDay={date}
  onSelectDay={fn}
  onClickPost={post => ...}
  highlightPostId={postId | undefined}  // for edit-mode (Item 20)
/>
```

When `context="composer-pane"`:
- Side-rail panel renders narrower (right pane is constrained)
- "New post" button hidden (composer is already open)
- "All profiles" filter inherits from the parent composer
- Header chrome simplified (no "Add profile", no "Timeline" toggle in composer context — only Month view)

When `context="page"`:
- Full chrome as currently implemented on `/company/social/calendar`

Investigate first: read the two existing implementations side-by-side, identify the divergence points, log them to DECISION_TRAIL D-051 before refactoring.

## Item 13 — Calendar revalidation on schedule success

After a successful schedule action in the composer, the main `/company/social/calendar` page doesn't immediately reflect the new post. The post does eventually appear (cache TTL or natural revalidation), but the UX feels broken.

Root cause: the schedule mutation doesn't invalidate the calendar's data fetch. Fix:

- After successful schedule API response (in the composer's submit handler), call the calendar's data hook's `mutate()` / `revalidate()` / `invalidateQueries()` — whichever pattern the codebase uses (grep for SWR vs TanStack Query vs custom).
- The MonthCalendar component (now shared between page and composer-pane) reads from a single data source, so a single invalidation reflects in both surfaces.
- Optimistic update bonus: insert the new post into the cached data immediately on schedule click, before server confirms. If server returns error, roll back.

If the codebase uses Next.js `revalidatePath`, the schedule API route should also call `revalidatePath('/company/social/calendar')`.

## Item 19 — Calendar chip content-type indicators

See `docs/briefs/composer-v3.2-polish/calendar-chip-variants.svg` for the four chip variants:

1. **Text-only post:** chip shows brand icon + HH:MM only (current behavior)
2. **Post with media:** chip shows brand icon + small `Image` (Lucide) icon prefix + HH:MM
3. **Post with link:** chip shows brand icon + small `Link2` (Lucide) icon prefix + HH:MM
4. **Post with both media and link:** chip shows brand icon + `Image` icon + HH:MM (media takes precedence; the post obviously has a link too but media is the dominant visual)

Indicator icons:
- Size: 12px (smaller than the 14px brand icon, sits between it and the time)
- Color: `--ink-2` to keep the chip visually quiet — it's a hint, not a callout
- Spacing: 4px gap between brand icon, indicator icon, and time

The chip's overall height (24px) and `--radius-md` stay unchanged.

Logic for which icon to show:
- If `post.media_urls?.length > 0` → show Image icon
- Else if `post.link_url || post.has_link` (whatever the data model field is — investigate) → show Link2 icon
- Else → no indicator icon

## Item 20 — Edit-mode cell highlight

When the composer is in edit mode (a post is being edited, not a new draft), the Calendar tab in the composer pane should highlight the day cell containing the post being edited.

Visual treatment: the day cell gets a 2px emerald border (vs the default 1px `--ink-7` border) plus a subtle `--emerald-bg-soft` fill. The post chip inside that cell gets a 2px emerald ring around it.

Pass `highlightPostId` prop (from Item 10's MonthCalendar API). The component:
- Finds the post in its data with id === highlightPostId
- Determines which day cell contains that post
- Applies the highlight treatment to that cell and that chip

If `highlightPostId` is undefined (new post mode), no highlight.

## PR-D2 verification

- Screenshot the main `/company/social/calendar` page — calendar renders as before
- Screenshot the composer's Calendar tab — now renders the same component, narrower
- Schedule a new post from composer — assert it appears on the main calendar within 1 second (no hard refresh needed)
- Screenshot of calendar with one post per variant type (text, with media, with link, with both) — assert each shows the correct indicator icon
- Open a scheduled post for edit, switch to Calendar tab in composer — assert that post's cell is highlighted

## PR-D2 e2e

- Seed 4 scheduled posts: text-only, with-media, with-link, with-both
- Open `/company/social/calendar`, assert all 4 chips visible with correct indicator icons (or absence)
- Open composer for new post, switch to Calendar tab, assert MonthCalendar renders, assert no cell is highlighted
- Schedule a 5th post for next Monday, assert the new post appears on calendar within the same page load (no manual refresh)
- Click an existing scheduled post chip → composer opens in edit mode, Calendar tab shows that post's cell highlighted with emerald border

**PR title:** `feat(calendar): unified MonthCalendar, content-type chips, edit-mode highlight`

---

# PR-D3 — Edit-mode header + Convert-to-draft + OG rehydrate

**Branch:** `feat/composer-edit-mode-parity`

Closes backlog items 15, 17, 18, 21.

## Item 15 — Click routing by post status

Currently, clicking a published post on the calendar opens "Post performance." Clicking a scheduled post should NOT — it should open the composer in edit mode.

Routing table:

| Post status | Click handler |
|---|---|
| `scheduled` (future `scheduled_for`) | Open composer overlay in edit mode, load this post's draft |
| `publishing` (in-flight, status='publishing') | Open composer in **read-only** edit mode with a "Publishing now…" pill in the header. All inputs disabled. |
| `published` | Open Post performance modal (current behavior) |
| `failed` | Open composer in edit mode + show an inline error banner above the editor with the failure reason and a "Retry publish" button |
| `draft` | Open composer in edit mode |

Implement as a router function: `getClickHandler(post: SocialPost) => () => void`. Single source of truth for all calendar surfaces (chips, side-rail cards, etc.).

The composer needs to accept an "edit context" prop that distinguishes:
- `mode: 'new'` (current default)
- `mode: 'edit', postId, readonly?: boolean`
- `mode: 'edit-failed', postId, failureReason`

Read-only mode disables all inputs, hides the "Schedule" / "Post now" tabs, shows only a "Close" affordance.

## Item 17 — Edit-mode header copy

When composer is in edit mode, the header title becomes:

> Edit post for [profile-icon] [profile-name]

For multiple profiles, truncate to the first profile name + "…":

> Edit post for [profile-icon] AIINX…

The profile icon is the same component used in profile chips (24px brand icon). The profile name is from `post.target_profiles[0].display_name` or equivalent.

When the composer is in `mode: 'new'`, title remains "New post" (current behavior).

When the composer is in `mode: 'edit-failed'`, title is:

> Edit post for [profile-icon] [profile-name] · Failed

With "Failed" in `--danger-fg`.

## Item 18 — "Convert to draft" tab option

When editing a scheduled post (`mode: 'edit'`, post status was `scheduled`), the third tab in the post-action row changes:

- New post: `Post now | Schedule | Publish regularly | Save as draft`
- Editing scheduled post: `Post now | Schedule | Publish regularly | Convert to draft`

"Convert to draft" is a state transition, not a new draft creation. It:

1. Sets `post.status = 'draft'`
2. Clears `post.scheduled_for` (NULL it)
3. Closes the composer
4. Invalidates the calendar (the post should disappear from the scheduled view)

The post is preserved in `social_posts` with status='draft'. It can be reopened from the Posts list page.

Add an API endpoint `POST /api/social/posts/[id]/convert-to-draft` if one doesn't already exist. Should use the existing auth + RLS patterns.

## Item 21 — OG metadata rehydrate on edit-mode open

When the composer opens an existing post that has a link with OG metadata, the link preview should render immediately — not require the user to re-paste the link to trigger an OG fetch.

Investigate: when a link is pasted in the current composer, OG metadata is fetched and stored somewhere (likely on `social_posts` as `link_og_title`, `link_og_image`, `link_og_description` columns — grep for the actual schema).

On composer open with an existing post:
- Read the stored OG fields from the post
- Render the link preview card with that cached data
- If OG fields are NULL but `link_url` is present (older posts pre-OG-feature), trigger a fresh fetch on open

The link preview component already exists from v3. This is purely a state-hydration fix.

## PR-D3 verification

- Click a scheduled post on calendar → composer opens with title "Edit post for [profile]…" and the post's content loaded
- Click a published post on calendar → Post performance modal opens (existing behavior unchanged)
- Click a failed post on calendar → composer opens with red "Failed" badge in title, error banner above editor, Retry button visible
- Click a publishing post → composer opens read-only with "Publishing now…" pill
- Edit a scheduled post, click "Convert to draft" tab → confirm dialog (optional but recommended) → click confirm → post disappears from calendar within 1s
- Open an existing post with a link → link preview renders immediately, no need to re-paste

## PR-D3 e2e

- Seed posts of each status: draft, scheduled, publishing, published, failed
- Click each on the calendar, assert correct destination per the routing table
- Open a scheduled post, assert header title contains "Edit post for"
- Open a failed post, assert "Failed" badge present in title and error banner visible
- Edit a scheduled post, click Convert to draft, assert post.status updates to 'draft' in DB and post disappears from calendar
- Seed a post with link_url + OG fields populated, open it for edit, assert link preview card renders without the user pasting anything

**PR title:** `feat(composer): edit-mode parity — header, convert-to-draft, OG rehydrate`

---

## Final retrospective

After PR-D3 merges and deploys, write `docs/briefs/composer-v3.2-polish/RETROSPECTIVE.md` covering:

- Each PR's investigation findings (especially MonthCalendar's divergence points from item 10)
- Any deviations from the brief
- Design tokens consumed; new patterns introduced (e.g. the `mode` prop pattern on the composer overlay)
- Backlog items discovered during the work (do not implement, just list for the next round)

Append final D-entry recording all PRs shipped, production SHAs, and any pending manual steps (env vars, etc.).

Begin with PR-D1.
