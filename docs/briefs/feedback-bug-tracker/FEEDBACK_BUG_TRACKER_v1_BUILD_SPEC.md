---
title: In-App Feedback, Ticketing & Issue-Triage — v1 BUILD SPEC
status: ready-to-build
owner: Steven (Opollo)
target_repo: opollo5/opollo-site-builder
module: lib/feedback/ (new; depends on lib/platform/)
canonical: this is the build artifact. It consolidates and supersedes the
  planning brief for implementation. The feasibility/plan doc remains the
  external-review companion only.
incorporates_review: priority (distinct from severity), feedback_ticket_events
  audit trail, controlled customer "Still broken" reopen, phase-sequential
  wording with mandatory human merge — approved for implementation.
---

# In-App Feedback, Ticketing & Issue-Triage — v1 Build Spec

## How to run this (kickoff)

Drop this file at `docs/briefs/feedback-bug-tracker/`, then give Claude Code:

> Read `docs/briefs/feedback-bug-tracker/FEEDBACK_BUG_TRACKER_v1_BUILD_SPEC.md`
> and **execute all phases sequentially without approval gates between phases.
> Human code review and merge approval remain mandatory** — you prepare and open
> PRs; a human reviews and merges them. First read
> `CLAUDE.md` and the `n-series-layer-rules` + `platform-customer-management`
> skills. **Use `is_opollo_staff()` / `is_company_member(company_id)` for RLS**
> (confirmed correct for company-scoped data — `auth_role()` is the older
> operator-auth system for `opollo_users`, not customer data; do not use it
> here). Just confirm those two function signatures exist in the latest
> migration, and confirm the `platform_*` table names and the next migration
> number, before writing the migration. Build emails on the **existing** layer
> (`lib/platform/notifications/dispatch.ts`, `lib/email/templates/base.ts`,
> `lib/email/sendgrid.ts`) — rebrand `base.ts`, do not create a new email
> module (§9). Work the build order (§11) as sequential PRs — one PR per phase —
> each meeting its acceptance criteria and the §12 verification gate before the
> next. Obey §1 (governance) as enforced behaviour. Final report only: prod URL,
> deployed screenshots, e2e `data-testid` proofs, round-trip + critical-path
> proofs.

Conventions to honour repo-wide: root-cause fixes only; all output inside the
project folder; never echo env values; visual-affecting PRs include a deployed
screenshot vs. reference comparison; a feature is not "done" until verified on a
production URL.

---

## 1. Governance — human review (enforce in code, not prose)

This is a **human-supervised, AI-assisted** issue-triage system, not an
autonomous bug-fixing one. Human triage is mandatory; nothing reaches production
without a human reviewing and merging a PR.

**Claude Code / the `bugs:push` automation MAY:** analyse tickets, reproduce
issues, prepare fixes, set *implementation* status (`in_progress`, `fixed`),
write `linked_pr_url`.

**Claude Code / the automation MUST NOT:** close tickets, verify fixes, mark
issues resolved for customers, set `verified` / `closed` / `wont_fix`, or merge
anything.

*In one line: AI can propose and implement fixes, but humans verify and close
tickets.*

**Enforced by:**
- `lib/feedback/tickets/update-status.ts` takes an explicit caller context —
  one of `{ kind:'human-staff', userId }`, `{ kind:'automation' }`, or
  `{ kind:'customer-reporter', userId }`. Permitted transitions per caller:
  - `human-staff`: all transitions.
  - `automation`: only `→ in_progress`, `→ fixed`. Any attempt to set
    `verified|closed|wont_fix` throws and is logged.
  - `customer-reporter`: **only** the controlled reopen `{fixed, verified} →
    in_progress`, and only on a ticket in the caller's own company (§4 "Still
    broken"). Nothing else.
  `verified_by`/`verified_at` are written **only** on a `human-staff` transition
  to `verified`.
- `scripts/bugs-push.ts` has no code path that writes a terminal state — it can
  emit only `status ∈ {in_progress, fixed}` and `linked_pr_url`.
- Every transition, assignment, and severity/priority change writes a row to
  `feedback_ticket_events` (§3) — the append-only audit trail.
- **Required tests:** assert the `automation` caller is rejected on each terminal
  transition; assert `customer-reporter` is rejected on everything except the
  reopen (`tests/regressions/feedback-governance.test.ts`).

---

## 2. Architecture & placement

Bug-tracking is a feature, so it gets its **own module** that consumes the
platform layer for identity/scoping/notifications — the same way `lib/social/`
does. The platform layer stays feature-agnostic (N-Series Rule 0): identity,
company-scoping, role checks, assignment-pool lookups, and notifications go
through `lib/platform/` public helpers (`isOpolloStaff`, `isCompanyMember`,
`getCurrentCompany`, `canDo`, `notifications.dispatch`). Never read
`platform_company_users` directly from `lib/feedback/`; never hardcode role
strings; never call SendGrid outside the email module's `send.ts`.

```
lib/feedback/
├── tickets/
│   ├── create.ts            validate + insert (company-scoped)
│   ├── assign.ts            assign/reassign (staff only; assignee must be staff)
│   ├── update-status.ts     state machine w/ caller-context guard (§1, §7)
│   ├── comments.ts          two-way thread add/list; is_staff derived server-side
│   └── queries.ts           list/get (member: own company; staff: all)
├── capture/
│   ├── selector.ts          stable-selector resolution (shared client/server type)
│   ├── screenshot.ts        signed upload + signed-on-read resolution
│   └── annotate.ts          (last) overlay shapes persisted with the screenshot
├── repo-bridge/
│   ├── pull.ts              Supabase → docs/bugs/<slug>.md
│   └── push.ts              docs/bugs/<slug>.md status/PR → Supabase (impl status only)
├── types/                   shared types incl. CallerContext, TicketStatus
└── README.md               write as you go (layer convention)

lib/email/templates/base.ts + lib/platform/notifications/dispatch.ts   (EXISTING email layer — rebrand, don't recreate; §9)

app/(platform)/admin/feedback/                 admin queue + ticket detail (staff only)
app/(platform)/feedback/                        customer ticket list + detail (company-scoped)
app/api/feedback/tickets/route.ts               POST create · GET list
app/api/feedback/tickets/[id]/route.ts          GET one · PATCH status/assignee (staff)
app/api/feedback/tickets/[id]/comments/route.ts POST · GET thread
app/api/feedback/tickets/screenshot-url/route.ts POST mint signed upload URL

components/feedback/FeedbackWidget.tsx          tab + rail + picker entry (client)
components/feedback/ElementPicker.tsx           crosshair, hover-highlight, click capture
components/feedback/CreateTaskPopup.tsx         the capture popup
components/feedback/TicketThread.tsx            shared two-way thread (admin + customer)
components/feedback/BugReplayOverlay.tsx        screenshot + click marker (admin)

scripts/bugs-pull.ts · scripts/bugs-push.ts     wired into package.json
```

---

## 3. Data model (migration)

Create one migration in `supabase/migrations/`. **Verify before writing:** the
next sequential migration number (the repo has a collision history); that the
`is_opollo_staff()` / `is_company_member()` function signatures exist in the
latest migration (these are **confirmed correct** for company-scoped data — do
**not** use the older `auth_role()` operator-auth helper, which is for
`opollo_users` operator surfaces, not customer data); and that
`platform_companies` / `platform_users` are the right table names. The SQL below
is the target; adjust identifiers to the repo's actual conventions. Reuse the
repo's shared `updated_at` trigger if one exists — don't redefine it.

```sql
create extension if not exists pgcrypto;

create table feedback_tickets (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references platform_companies(id),
  title           text not null,
  description     text not null check (char_length(description) <= 2000),
  severity        text not null default 'normal'
                    check (severity in ('low','normal','high','blocker')),
                    -- severity = how bad is it (reporter-set at create)
  priority        text not null default 'medium'
                    check (priority in ('low','medium','high','urgent')),
                    -- priority = what do we work on first (admin-controlled, set at triage)
  status          text not null default 'backlog'
                    check (status in ('backlog','triaged','in_progress','fixed',
                                      'verified','wont_fix','closed')),
  assignee_id     uuid references platform_users(id),   -- implementation owner (staff; app-enforced)
  triaged_by      uuid references platform_users(id),   -- triage owner
  triaged_at      timestamptz,
  verified_by     uuid references platform_users(id),   -- HUMAN verifier only
  verified_at     timestamptz,
  tags            text[] not null default '{}',
  page_url        text not null,
  route_pattern   text,
  css_selector    text not null,
  element_label   text,
  click_x_pct     numeric not null check (click_x_pct between 0 and 100),
  click_y_pct     numeric not null check (click_y_pct between 0 and 100),
  viewport_w      integer not null,
  viewport_h      integer not null,
  device_pixel_ratio numeric,
  user_agent      text,
  console_errors  jsonb,
  screenshot_path text,                  -- storage object path (raw; sign on read)
  annotation      jsonb,                 -- optional overlay shapes (added last)
  repo_ref        text,                  -- docs/bugs/<slug>.md once synced
  linked_pr_url   text,                  -- automation may write this
  created_by      uuid not null references platform_users(id),  -- reporter
  updated_by      uuid references platform_users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  deleted_by      uuid references platform_users(id)
);

create index on feedback_tickets (company_id) where deleted_at is null;
create index on feedback_tickets (status)     where deleted_at is null;
create index on feedback_tickets (assignee_id);

create table feedback_ticket_comments (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references feedback_tickets(id) on delete cascade,
  body        text not null,
  author_id   uuid not null references platform_users(id),
  is_staff    boolean not null default false,   -- derived server-side at insert
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  uuid references platform_users(id)
);
create index on feedback_ticket_comments (ticket_id) where deleted_at is null;

-- append-only audit trail: assignment, reassignment, status, severity, priority
create table feedback_ticket_events (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references feedback_tickets(id) on delete cascade,
  event_type  text not null
                check (event_type in ('created','assigned','reassigned',
                       'status_changed','severity_changed','priority_changed',
                       'reopened_by_customer','verified','closed')),
  from_value  text,                 -- prior value where applicable
  to_value    text,                 -- new value where applicable
  actor_id    uuid references platform_users(id),   -- null = automation
  actor_kind  text not null default 'human-staff'
                check (actor_kind in ('human-staff','automation','customer-reporter','system')),
  created_at  timestamptz not null default now()
);
create index on feedback_ticket_events (ticket_id, created_at);

alter table feedback_tickets         enable row level security;
alter table feedback_ticket_comments enable row level security;
alter table feedback_ticket_events   enable row level security;

-- service role: full access (for bugs:push + signed uploads)
create policy feedback_tickets_service on feedback_tickets
  for all to service_role using (true) with check (true);

-- read: staff see all; members see own company; soft-deleted are staff-only
create policy feedback_tickets_read on feedback_tickets for select using (
  (deleted_at is null and (is_opollo_staff() or is_company_member(company_id)))
  or (deleted_at is not null and is_opollo_staff())
);

-- insert: any member of the company, or staff
create policy feedback_tickets_insert on feedback_tickets for insert with check (
  is_opollo_staff() or is_company_member(company_id)
);

-- update (status/assignee/triage/verify/severity/priority/repo_ref/pr): Opollo staff only.
-- The controlled customer reopen (§4 "Still broken") does NOT widen this policy;
-- it runs server-side via the service-role path after validating membership +
-- the allowed transition, so direct client updates stay staff-only.
create policy feedback_tickets_update on feedback_tickets for update using (
  is_opollo_staff()
);

-- comments service-role + read/insert for accessible tickets
create policy feedback_comments_service on feedback_ticket_comments
  for all to service_role using (true) with check (true);
create policy feedback_comments_read on feedback_ticket_comments for select using (
  exists (select 1 from feedback_tickets t where t.id = ticket_id
          and (is_opollo_staff() or is_company_member(t.company_id)))
);
create policy feedback_comments_insert on feedback_ticket_comments for insert with check (
  exists (select 1 from feedback_tickets t where t.id = ticket_id
          and (is_opollo_staff() or is_company_member(t.company_id)))
);

-- events: append-only. Readable with the parent ticket; written by the server
-- (service role) from the mutation paths only — no client insert/update/delete.
create policy feedback_events_service on feedback_ticket_events
  for all to service_role using (true) with check (true);
create policy feedback_events_read on feedback_ticket_events for select using (
  exists (select 1 from feedback_tickets t where t.id = ticket_id
          and (is_opollo_staff() or is_company_member(t.company_id)))
);
-- (no insert/update/delete policy for authenticated → effectively read-only to clients)
```

**Storage:** private bucket `feedback-screenshots`.

```sql
insert into storage.buckets (id, name, public)
values ('feedback-screenshots', 'feedback-screenshots', false)
on conflict (id) do nothing;
```
Store the **object path** in `screenshot_path`; resolve to a short-lived signed
URL on read (mirror the existing `resolve-media.ts`). Never persist signed URLs.

> Note: column-level RLS won't stop a staff `UPDATE` from setting `verified` —
> that guard lives in `update-status.ts` (§1). RLS gates *who* can write; the
> caller-context guard gates *which transition* and writes `verified_by`.

---

## 4. API contracts

All routes require an authenticated session. Boundary checks return `401`
(unauthenticated) / `403` (forbidden) / `404` (not visible under RLS).

| Route | Method | Who | Request | Success |
|---|---|---|---|---|
| `/api/feedback/tickets` | POST | member or staff (own company) | ticket payload (below) | `201 { id, status:'backlog' }` |
| `/api/feedback/tickets` | GET | member (own company) / staff (all) | query: `status, severity, priority, companyId?(staff), assigneeId?, hasPr?` | `200 { tickets: [...] }` |
| `/api/feedback/tickets/[id]` | GET | RLS-visible | — | `200 { ticket, comments, events }` |
| `/api/feedback/tickets/[id]` | PATCH | staff | `{ status?, assigneeId?, severity?, priority?, tags? }` | `200 { ticket }` |
| `/api/feedback/tickets/[id]/reopen` | POST | **reporter's company member** (controlled) | `{ comment? }` | `200 { ticket }` — see "Still broken" |
| `/api/feedback/tickets/[id]/comments` | POST | member/staff on visible ticket | `{ body }` | `201 { comment }` |
| `/api/feedback/tickets/[id]/comments` | GET | member/staff on visible ticket | — | `200 { comments: [...] }` |
| `/api/feedback/tickets/screenshot-url` | POST | member/staff | `{ contentType }` | `200 { uploadUrl, objectPath }` |

**POST ticket payload:**
```jsonc
{
  "title": "string",
  "description": "string (<=2000)",
  "severity": "low|normal|high|blocker",
  "tags": ["string"],
  "assigneeId": "uuid|null",       // staff-only; ignored/validated for members
  "pageUrl": "string",
  "routePattern": "string|null",
  "cssSelector": "string",
  "elementLabel": "string|null",
  "clickXPct": 0-100,
  "clickYPct": 0-100,
  "viewportW": 0, "viewportH": 0,
  "devicePixelRatio": 1.0,
  "userAgent": "string",
  "consoleErrors": [ /* ring-buffer entries */ ],
  "screenshotObjectPath": "string|null"  // from screenshot-url, after upload
}
```

**Server rules (non-negotiable):**
- `PATCH .../[id]` status changes call `update-status.ts` with
  `{ kind:'human-staff', userId }`. There is no API surface that lets a client
  set status as `automation` — that context exists only inside `bugs:push`.
- **`priority` is admin-controlled:** only a staff `PATCH` may set it; it
  defaults to `medium` and is never accepted from a member or from the create
  payload. (Severity is reporter-set at create; priority is set at triage.)
- Comment `is_staff` is computed from `isOpolloStaff()` server-side; the client
  value is ignored.
- A non-staff caller cannot set `assigneeId`; `assign.ts` rejects a non-staff
  assignee regardless of caller.
- **"Still broken" reopen (`POST .../[id]/reopen`):** allowed only to a member of
  the ticket's own company, only when status is `fixed` or `verified`. The route
  validates membership + current status, then calls `update-status.ts` with
  `{ kind:'customer-reporter', userId }` (→ `in_progress`) via the service-role
  path, posts the optional comment, writes a `reopened_by_customer` event, and
  notifies the assignee/admins. Any other transition from this context is
  rejected. This is the controlled exception to "customers don't change status."
- **Every mutation writes an event:** `create.ts`, `assign.ts`,
  `update-status.ts`, and severity/priority changes append a
  `feedback_ticket_events` row (`event_type`, `from_value`, `to_value`,
  `actor_id`, `actor_kind`). Events are append-only — never updated or deleted.

---

## 5. Capture widget (client)

Mounted **once** in the authenticated app shell — after auth resolves, never for
logged-out users, never on public/magic-link routes. Behind feature flag
`FEATURE_FEEDBACK_WIDGET`. Re-skin to the Opollo design system: Geist type,
clinical white surfaces, emerald `#00BF66` **sparingly** for the single primary
action, Linearicons; **use CSS variables + existing `components/ui` primitives,
no hardcoded hex** (the layout audit flags raw hex). Read `frontend-design`
SKILL before building UI.

**Tab → rail.** Collapsed: small tab fixed bottom-right. Click → slim vertical
rail slides in (200ms motion tier): brand mark, `+`, open-count badge (open
tickets for current company), collapse chevron.

**`+` → element picker (`ElementPicker.tsx`).** Enters pick mode: crosshair
cursor; on `mousemove`, the element under the cursor gets a live outline via a
single absolutely-positioned overlay box tracking `getBoundingClientRect()` —
**overlay only, never mutate the page's styles or capture events outside pick
mode.** On click, capture:
- **selector** (`selector.ts`), priority: `[data-testid]` on element/nearest
  ancestor → stable `id` → short `tag:nth-of-type` chain (cap ~4 levels).
- **click coords as % of the element box** (survives reflow).
- **element_label**: aria-label → visible text (truncated) → tag name.

**Create popup (`CreateTaskPopup.tsx`).** Left: description + `0/2000` counter +
emoji/attach; the captured screenshot thumbnail with a pin at the click point +
an `Annotate` button (annotate is the last/deferrable build step). Right:
Assignee (staff list), Severity, Status (default `backlog`), Tags, "keep these
settings" (persists selections this session, client-only). Submit → `screenshot-url`
→ upload PNG → `POST /tickets`.

**Screenshot + console.** Screenshot via `html2canvas` (open-source npm lib, not
a vendor); draw the pin; upload to the signed URL. Cross-origin iframes/some
canvas won't render — submit anyway with the partial image (selector + coords +
console are the load-bearing forensics). Install a console ring buffer at shell
mount: last N `console.error`/`warn` + `window.onerror`/`unhandledrejection`,
sent as `consoleErrors`.

**Required `data-testid`s:** `feedback-tab`, `feedback-rail`, `feedback-picker`,
`feedback-create-popup`, `feedback-submit`.

---

## 6. Admin & customer surfaces

**Admin board — `app/(platform)/admin/feedback/`, `is_opollo_staff()` only**
(403 otherwise). Cross-company queue: rows showing company, title, severity,
**priority**, status, assignee, route, age; filters (company/status/severity/
**priority**/assignee/has-PR); default sort surfaces high priority first. Row →
detail:
- `BugReplayOverlay`: render the screenshot, draw the marker at
  `click_x_pct/click_y_pct` (the headline triage feature).
- Forensic panel: route, selector, viewport, UA, console errors (collapsed).
- Assign/reassign; **priority control** (admin-only); status control (§7);
  `TicketThread`; and an **event timeline** (`feedback_ticket_events`) showing
  who reported / triaged / assigned / changed status / verified, with timestamps.
- testids: `admin-feedback-board`, `bug-replay-marker`, `ticket-event-timeline`.

**Customer view — `app/(platform)/feedback/`, company-scoped.** A member sees
**only their own company's** tickets (RLS-enforced — the multi-tenant safety
boundary). List + detail: description, read-only screenshot with pin, status,
the event timeline (read-only), and `TicketThread` to reply. No admin controls,
no cross-company access. When the ticket is `fixed` or `verified`, the customer
sees a **"Still broken"** action that calls `POST .../[id]/reopen` (→
`in_progress`, posts a comment, notifies) — the one controlled status action a
customer has, so a fix the customer disputes can't sit closed. testids:
`ticket-still-broken`.

**`TicketThread`** serves both: renders staff vs reporter sides distinctly, same
post path. testids: `ticket-thread`, `ticket-reply`.

---

## 7. Status state machine

`lib/feedback/tickets/update-status.ts` is the single source of truth.

```
backlog → triaged → in_progress → fixed → verified → closed
any     → wont_fix → closed
fixed     → in_progress    (staff reopen after failed verification)
verified  → in_progress    (customer "Still broken", or staff reopen)
```

| Transition target | Allowed caller |
|---|---|
| `in_progress`, `fixed` | human-staff **or** automation |
| `{fixed, verified} → in_progress` (reopen) | human-staff **or** customer-reporter (own company only) |
| `triaged`, `verified`, `closed`, `wont_fix` | **human-staff only** |

The guard rejects `automation` → any terminal state, and rejects
`customer-reporter` → anything except the reopen, throwing+logging (§1).
Customers otherwise only create (`backlog`) and comment. `verified_by`/
`verified_at` are written only on a human transition to `verified`. Every
transition appends a `feedback_ticket_events` row. (Kanban drag-UI deferred; the
field + transitions exist now.)

---

## 8. Notifications

Add `platform_notifications` types + templates via
`lib/platform/notifications/dispatch.ts` (never email from `lib/feedback/`).
Every email renders through the §9 branded base template. Recipients are
**resolved and passed to `dispatch()`** — the same pattern existing events use
(e.g. `approval_requested` resolves company admins). "Opollo admins" below means
the resolved set of Opollo staff (`platform_users` where `is_opollo_staff()`);
**confirm the canonical staff-recipient resolver in the repo and reuse it** —
don't invent an env var for the recipient list.

| Event | Recipient | Channel |
|---|---|---|
| `ticket_created` | Opollo staff (resolved) | email + in-app |
| `ticket_created` + `severity='blocker'` | Opollo staff (resolved) | **immediate, always — un-suppressible** |
| `ticket_assigned` | assignee | in-app (email optional) |
| `ticket_comment_added` (staff author) | the **reporter** | email + in-app |
| `ticket_comment_added` (reporter author) | the **assignee** (else Opollo staff) | email + in-app |
| `ticket_status_changed` | reporter | in-app; email on `fixed`/`verified` |

> **One product decision for Steven:** should blocker alerts go to *all* Opollo
> staff, or a specific subset/address? Default below is all staff; narrow it if
> you'd rather a named on-call address own escalations.

**Reply direction, plainly:** admin reply emails the reporter; reporter reply
emails the assignee (or Opollo admins if unassigned).

**Cadence:** v1 is immediate-per-event, but route every send through a single
cadence decision point (per-recipient/per-type) so a future digest mode is a
config flip, not a refactor. Blocker stays locked to immediate.

```
Future enhancement — cadence:
  digest    → normal/low ticket_created (batched)
  immediate → blocker ticket_created (locked on)
  immediate → direct replies + assignment
```

---

## 9. Companion workstream — branded email shell (platform-wide)

**Separate system, coupled delivery.** Platform-wide: *every* Opollo email
(invitations, approvals, connection-loss, post-failed, and §8 here) renders
through one branded shell with content in a defined slot. **Build on the
existing email layer — do NOT create a parallel module.** The repo already has:
`lib/platform/notifications/dispatch.ts` (the single send entry point — routes
call `dispatch(event, recipients, data)`), `lib/email/sendgrid.ts` +
`lib/email/templates/base.ts` (the **only** files permitted to import
`@sendgrid/mail`; every send writes to `platform_email_log`). So the chokepoint
and the SendGrid-import guard the original draft called for **already exist** —
this workstream is to *rebrand and harden the existing base template*, not to
build new plumbing. The feedback emails are its first consumers and forcing
function; migrating the pre-existing templates onto the rebranded base is a fast
follow (they keep working until moved).

Email is its own discipline: clients (Outlook especially) mangle modern web
HTML. Use **table-based layout, fully inlined CSS, a system-font stack, and a
plaintext alternative.** Web components and CSS-variable tokens cannot be reused;
bake brand values literal.

```
lib/email/
├── templates/base.ts   EXISTING — make this the ONE branded shell (logo header, body slot, footer)
├── templates/          one content-only file per type (NO chrome); existing per-type templates migrate onto base
└── sendgrid.ts         EXISTING transport — only this + base.ts import @sendgrid/mail
lib/platform/notifications/dispatch.ts   EXISTING — single send entry; all events go through it
```

**Forcing consistency (the actual requirement):**
- Single chokepoint **already enforced**: `dispatch.ts → templates/base.ts →
  sendgrid.ts`; only `sendgrid.ts` + `base.ts` import the SendGrid SDK, checked
  by the existing static audit (`npm run audit:static`). Keep that guard; add a
  test that every feedback template renders inside `base.ts`.
- Templates are content-only (heading + body blocks + optional single CTA) and
  cannot express their own chrome — so a template *physically cannot* be
  off-brand.
- Rebuild `base.ts` as a properly email-safe branded shell (consider
  **`react-email`** or **MJML** — open-source libs, not a service — if the
  current base is hand-rolled and fragile). SendGrid stays pure transport; **do
  not** move chrome into SendGrid's editor.
- Brand baked literal: emerald `#00BF66` CTA only; `#FAFAFA`/white surfaces;
  **system-font stack** (Geist won't load in email — carry brand via logo +
  colour). Absolute-URL logo; preheader + plaintext on every email.
- Staff-only dev preview route `/admin/email-preview/[template]` with sample
  data. Cross-client pixel QA (Litmus/etc.) is **out of scope** for v1.

---

## 10. Repo bridge (the CC mirror — not the conversation)

Vercel can't write git at runtime, so Supabase is the source of truth and
scripts bridge a **read-only-for-humans** mirror. CC reads the mirror, prepares
a fix, and **opens a PR** — no direct production write, no auto-merge, no path to
the live product that skips a human (§1).

**`scripts/bugs-pull.ts`** — service-role; tickets where
`status ∈ {backlog,triaged,in_progress}` and `deleted_at is null`, **ordered by
priority then severity** so the agent works the most important first. Writes/
updates `docs/bugs/<slug>.md` (idempotent; updates in place). Sets `repo_ref` on
first pull.

```markdown
---
ticket_id: <uuid>
slug: <short>
status: backlog
severity: high
priority: urgent
company: Skyview Technology
assignee: steven@opollo.com
route: /sites/[id]/preview
page_url: https://app.opollo.com/...
selector: '[data-testid="hero-cta"]'
click_pct: { x: 42.1, y: 71.0 }
viewport: { w: 390, h: 844 }
screenshot: <signed-url, regenerated each pull>
reported_by: jane@skyview.com
reported_at: 2026-06-03T...
linked_pr_url: null
---

## Report
<description>

## Console errors
<formatted console_errors>

## Thread (read-only mirror — reply in-app, not here)
<comments, newest last>

## Resolution (filled by Claude Code — CLAUDE.md report-back template)
<!-- Working analog: <file>:<lines> — … / Diff: … / Fix: … -->
```

**`scripts/bugs-push.ts`** — parses front-matter; writes back **only**
`status ∈ {in_progress, fixed}` and `linked_pr_url` (service-role). No terminal
states, no comments. Wire both into `package.json` (`bugs:pull`, `bugs:push`).

A scheduled GitHub Action wrapping `bugs:pull` is a later thin wrapper — not v1.

---

## 11. Build order — sequential PRs, each with acceptance criteria

**P1 · Foundation.** Migration (tables/RLS/storage) applied locally; module
skeleton + README; `CallerContext`/`TicketStatus` types.
*Accept:* tables + RLS exist; a service-role insert + a member-scoped select
behave per policy in a test.

**P2 · API.** All routes + boundary gates + `update-status.ts` guard + event
writes.
*Accept:* `curl` proves create/list/get/patch/comments/reopen; member list
returns only own-company tickets; a simulated `automation` terminal transition is
rejected and a `customer-reporter` non-reopen transition is rejected (unit
tests); `priority` is rejected from a member and accepted from staff; each
mutation writes a `feedback_ticket_events` row.

**P3 · Capture.** Tab → rail → `+` → crosshair picker → selector/coord/console
capture → screenshot+pin → create popup → submit.
*Accept:* a logged ticket persists selector, `click_*_pct`, viewport, console,
and a screenshot path; testids present.

**P4 · Triage + thread.** Admin board (severity + priority columns/filters,
priority control, event timeline), `BugReplayOverlay`, assignment, status
controls, `TicketThread`; customer list + detail + reply + "Still broken".
*Accept:* the marker renders at the stored percentage on a different viewport; a
reporter reply and a staff reply both round-trip; customer cannot see another
company's ticket; the event timeline shows the report/triage/assign/status
history; a customer "Still broken" on a `verified` ticket moves it to
`in_progress`, posts a comment, writes a `reopened_by_customer` event, and
notifies — and the same action is rejected on a `closed` ticket.

**P5 · Email shell (§9).** `layout` + primitives + `render`/`send` + the
SendGrid-import CI guard + dev preview route.
*Accept:* every template renders inside the layout; the CI guard fails on a
planted stray SendGrid import; a sent test email has HTML + plaintext parts.

**P6 · Notifications (§8).** All events through dispatch + the §9 shell.
*Accept:* a blocker ticket fires immediate admin email + in-app; admin reply
emails the reporter; reporter reply emails the assignee.

**P7 · Repo bridge (§10).** `bugs:pull`/`bugs:push` + `docs/bugs/` + package.json.
*Accept:* pull materialises a file with parseable front-matter; push writes
`fixed` + PR link back; push **cannot** write a terminal state (test).

**P8 · Rollout.** Feature flag on for UAT companies + Opollo Internal; mount in
app shell.
*Accept:* widget visible for a flagged company, absent for an unflagged one and
for logged-out users.

**P9 · Annotate (last; may slip to v1.1).** Draw on the screenshot.

**P10 · Verify & ship.** e2e + regressions; deploy; run §12; apply prod
migration; round-trip + critical-path proofs; final report.

---

## 12. Verification gate (CLAUDE.md — non-negotiable)

A feature is not shipped until verified on a customer-facing production URL.
Final report includes:

1. **Production URL** with the collapsed tab on a real authenticated route.
2. **Deployed screenshots:** rail; crosshair picker highlighting an element;
   create popup; admin board with the click marker on a replayed screenshot;
   customer ticket detail with a two-way thread — side-by-side with the BugHerd
   reference where relevant.
3. **e2e (Playwright)** asserting testids: `feedback-tab`, `feedback-rail`,
   `feedback-picker`, `feedback-create-popup`, `feedback-submit`,
   `admin-feedback-board`, `bug-replay-marker`, `ticket-thread`, `ticket-reply`,
   `ticket-still-broken`, `ticket-event-timeline`. Marker test asserts the
   stored-percentage offset; thread test asserts a reply round-trips and fires
   the notification path; reopen test asserts "Still broken" moves a `verified`
   ticket to `in_progress`.
4. **`curl` proof:** create returns a row; list scopes correctly (member vs
   staff); comments post from each side; `priority` rejected from a member,
   accepted from staff.
5. **Migration applied to production** (merged ≠ applied) — confirm all three
   tables + RLS exist in prod.
6. **Round-trip:** log a ticket in prod → `bugs:pull` materialises the file →
   set status in the file → `bugs:push` → prod row updates. Plus admin reply →
   reporter receives email.
7. **Governance proof:** the automation path is rejected on a terminal
   transition; the `customer-reporter` path is rejected on any non-reopen
   transition (regression tests green); a `blocker` ticket fired the immediate
   admin alert; mutations are recorded in `feedback_ticket_events`.

Pin the click-marker math and the governance guards (automation + customer-
reporter) in `tests/regressions/`.

---

## 13. Boundaries & watch-outs

- **Not Sentry.** This is for human-logged issues; uncaught runtime errors stay
  with Sentry (already running). Do not auto-ingest runtime errors into
  `feedback_tickets`; don't turn blocker escalation into a second runtime
  alerter.
- **Don't mutate page styles in pick mode** — overlay only.
- **Resilient selectors** — `data-testid`/id over deep structural paths.
- **Percentage coords, not pixels** — marker must land on a different screen.
- **Sign screenshots on read** — never persist signed URLs.
- **Derive `is_staff` server-side**; never trust the client.
- **Assignee pool = staff only** — enforce in `assign.ts` (FK allows any user).
- **Feature logic stays in `lib/feedback/`**; reach into `lib/platform/` only
  via public helpers.
- **Verify RLS helper names + migration number** against the repo before writing
  (§3).
- **No `<style>`/flexbox/grid/CSS-vars in email output**; test in Outlook;
  every email gets a plaintext part (§9).