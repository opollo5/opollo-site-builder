# Feedback Module — Open Backlog

Consolidated from: v1.0–v1.3 spec §6 audits, PR #1296 audit, and in-code
TODO/backlog comments in `lib/feedback/` and `components/feedback/`.

Base: `main @ 4343ec5e` (v1.3 shipped). Build nothing from this file — it is
an audit record only.

---

## P0 — Must fix before external rollout

### Email body never verified in Outlook / Gmail
**Why it matters:** The rebranded `lib/email/templates/base.ts` uses table-based
layout and inlined CSS (spec compliant), but the actual render in real email
clients has never been checked. Outlook in particular mangles CSS that looks
correct in Chrome. A broken email template silently degrades every notification.
**Status:** Open. `app/(platform)/admin/email-preview/[template]/page.tsx` has
a dev-preview route, but Litmus / cross-client pixel QA was explicitly deferred
in v1.0 as "out of scope for v1." No one has opened the emails in Outlook since
then.
**Source:** `app/(platform)/admin/email-preview/[template]/page.tsx` comment;
v1.0 spec §9.

---

## P1 — High-value, not yet scheduled

### No status / "include deleted" filter on `/admin/feedback`
**Why it matters:** The board only shows open tickets (`deleted_at IS NULL`). Staff
cannot see `closed`, `wont_fix`, or soft-deleted tickets without a direct DB query.
As ticket volume grows this will be a constant friction point.
**Status:** Open. `listTickets` accepts a `status` filter but the admin board
page passes none and has no filter UI.
**Source:** v1.2 spec implied; not built in any pass.

### Company name not shown for external companies
**Why it matters:** Every ticket currently shows `#<short-id>` with no company
label. When Opollo-internal staff is the only reporter this is fine. Once external
(non-Opollo) companies start filing tickets, staff cannot tell at a glance which
company a ticket belongs to without clicking into it.
**Status:** Open. The old raw `company_id` UUID was removed (v1.2). A company
name lookup from `platform_companies` has not been added.
**Source:** v1.3 §6 audit; v1.2 §6 note.

### "Don't show again" on the intro modal
**Why it matters:** The intro modal ("Show us where it's not working") appears
every time the tab is clicked. Repeat reporters find this friction unnecessary.
**Status:** Open — explicitly noted as a backlog item in the code comment at
`components/feedback/FeedbackWidget.tsx:30`.
**Source:** v1.3 implementation comment.

### Customer-facing event timeline does not resolve staff names
**Why it matters:** The customer ticket detail (`/feedback/[id]`) shows the event
timeline with generic labels ("Assigned to support team", etc.) — no staff names.
The admin detail resolves `actor_id → platform_users.full_name` correctly (v1.1
§2 fix), but `FeedbackDetailClient.tsx` uses a static `eventLabel()` function
with no lookup. Acceptable now but inconsistent.
**Status:** Open.
**Source:** `app/(platform)/feedback/[id]/FeedbackDetailClient.tsx` — `eventLabel()`
function uses hard-coded strings, no actor_id resolution. Contrast with
`app/(platform)/admin/feedback/[id]/page.tsx` which calls `resolveActorNames()`.

### Comment thread shows "Opollo" / "Reporter" not actual names
**Why it matters:** `TicketThread.tsx` labels authors as "Opollo" or "Reporter"
based on the `is_staff` boolean. The staff member's name (from `platform_users`)
is never shown. Low friction now, more useful as team grows.
**Status:** Open. `is_staff` is the only column checked in the thread render
(`components/feedback/TicketThread.tsx:96`).
**Source:** Code inspection.

---

## P2 — Medium priority / quality-of-life

### P9 Annotate — draw on the screenshot
**Why it matters:** The spec v1.0 included an annotation layer (draw arrows/boxes
on the screenshot) to let reporters mark exactly what's wrong. The type definitions
exist in `lib/feedback/capture/annotate.ts` and `lib/feedback/types/` (`annotation`
column on `feedback_tickets`), but no drawing UI was built.
**Status:** Deferred. The v1.0 spec explicitly marked it "last; may slip to v1.1"
and it was never scheduled. `lib/feedback/capture/annotate.ts` has the type
definitions only; `AnnotateOverlay.tsx` (referenced in the file) does not exist.
**Source:** v1.0 build spec §11 P9; `lib/feedback/capture/annotate.ts:2`.

### Hover element-highlight in picker mode
**Why it matters:** During picker mode, the user needs visual confirmation of which
element will be captured.
**Status:** ✅ **Built and shipped (v1.3).** `ElementPicker.tsx` renders a
`pointer-events-none` fixed overlay div tracking `getBoundingClientRect()` on
every `mousemove` — 2px emerald border + faint emerald fill, updating live. The
div is conditional on `highlightRect` (non-null after the first mousemove). See
`components/feedback/ElementPicker.tsx:106-117`.

### "Queue for Claude Code" button on the admin board
**Why it matters:** Would allow a staff member to flag a ticket as high-priority
for the next `bugs:pull` session without leaving the browser.
**Status:** Deferred. The v1.2 spec explicitly deferred it: "current flow is
pull-based via `bugs:pull`." The `bugs:pull` script prioritises by priority then
severity, so the workaround is to set priority to `urgent`. A tagging mechanism
is a future v2 item.
**Source:** v1.2 spec §8; v1.3 §6 audit.

### E2E test suite never run against UAT / production
**Why it matters:** The Playwright `feedback-widget.spec.ts` suite requires Docker +
local Supabase (global-setup seeds auth users). All tests skip in CI because
`FEATURE_FEEDBACK_WIDGET` is not set and Docker is not available. The suite has
never exercised the full round-trip on a real deployed environment.
**Status:** Open. Requires Docker Desktop + `STAGING_UAT_SECRET` + `VERCEL_BYPASS_SECRET`
in the session. See `docs/backlog/v1-launch-blockers.md` note on e2e.
**Source:** v1.0 spec §12; v1 launch blockers.

### `bugs:pull` pulls `deleted_at IS NULL` tickets but has no date-range option
**Why it matters:** A large ticket history will make `docs/bugs/` grow without
bound. There's no flag to pull only recent tickets or tickets created after a
given date.
**Status:** Open. `lib/feedback/repo-bridge/pull.ts` has a `ACTIVE_STATUSES`
filter but no date range or limit.
**Source:** Code inspection.

---

## P3 — Low priority / polish

### Branded email template not verified end-to-end in a sent message
**Why it matters:** The dev-preview route (`/admin/email-preview/[template]`)
renders correctly in Chrome but the path to actual delivery (SendGrid → inbox)
has never been smoke-tested end-to-end. Blocker email subjects, ticket-created
content, and ticket-status-changed bodies are untested in production.
**Status:** Open. Integration is wired; no smoke-test has confirmed a live send.
**Source:** v1.0 spec §9 "dev preview route with sample data. Cross-client pixel
QA is out of scope for v1."

### Empty-staff blocker alert silently drops
**Why it matters:** `resolveOpolloAdmins()` returns `[]` when no `platform_users`
row has `is_opollo_staff=true`. The event is logged but no alert fires. An
Opollo staff user must always exist, so this is low risk but represents a silent
failure mode if the table is ever corrupted or migrated.
**Status:** Known limitation — the `throw` was reverted (PR #1292) because it
broke `connection_lost` notifications via `Promise.all`. Comment is in code at
`lib/platform/notifications/recipients.ts:75-82`. A proper on-call pager
integration is the correct fix.
**Source:** v1.1 carry-forward; v1.3 §6 audit.

### Admin board route column shows full URL not path
**Why it matters:** The route column in the listing truncates long URLs at the
domain. The path portion (the useful part) is shown in the `title` tooltip but
not visible at a glance.
**Status:** Partially addressed (v1.2 added `title={routeFull}` tooltip). Full
path extraction is done (`routeDisplay` helper extracts `u.pathname`) but the
truncation in the column cell still shows the full URL before truncation. Minor
UX issue.
**Source:** v1.2 §6; v1.3 §5 confirmed shipped.

### Intro modal has no animation / transition
**Why it matters:** The Dialog opens without a transition because the default
Radix animation classes reference CSS keyframes that may not be defined in this
project's Tailwind config. No broken behaviour — just abrupt open.
**Status:** Open. Low impact. Check Tailwind config for `opollo-fade-in` /
`opollo-fade-out` keyframes.
**Source:** `components/ui/dialog.tsx:28-29` references
`data-[state=open]:opollo-fade-in` classes.

---

## Known limitations (will not fix without explicit decision)

| Limitation | Reason not fixing |
|---|---|
| `title` column stays NOT NULL in DB; old tickets keep their old title | No migration needed; auto-generated title for new tickets; existing titles are still valid data |
| Pre-existing tickets (`3b98bd5f` etc.) have wrong `click_x_pct/y_pct` (element-box-relative) | v1.1 §1 fixed capture for new tickets; old stored values cannot be corrected without re-capturing |
| `bugs:push` terminal state rejection is audit-log only, no runtime block at DB level | Guard is enforced in `push.ts`; DB policy is staff-only for UPDATE anyway |
| `ticket_number` backfills existing rows via identity sequence (may start at a non-1 number) | PostgreSQL fills in sequence order; the first existing row gets `1`, next gets `2`, etc. No collision risk. Acceptable. |
