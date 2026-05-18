# Scheduling Proposal — Opollo Composer

**Companion document to Opollo Composer Parity Spec v1.3 §6, §7, §14.**
**Status:** Draft for director review.
**Author:** Steven Morey (with Claude as drafting collaborator).
**Date:** May 18, 2026.

You said the v1.3 spec was light on the scheduling proposal. This document fixes that. It is the authoritative source for **how scheduling works in the composer**, from the moment a user picks a tab to the moment a post lands on a destination platform.

---

## 1. The four scheduling modes — at a glance

The composer's scheduling card has four tabs, each backed by a distinct database state and a distinct publish behaviour:

| Tab | When to use | Submit label | DB state after submit | Triggers a publish job? |
|---|---|---|---|---|
| **Post now** | Publish in the next 60 seconds | "Post now" | `publishing` → `published` | Yes, immediate |
| **Schedule** | Publish at one or more specific times | "Schedule post" | `scheduled` | Yes, at each `scheduled_at` |
| **Publish regularly** | Repeat on a cadence until a date or forever | "Save schedule" | `recurring` (parent) + `scheduled` (children) | Yes, per occurrence |
| **Save as draft** | Park the post without scheduling | "Save draft" | `draft` | No |

Tabs are mutually exclusive — one post can only be in one mode at a time. Switching tabs in the composer **does not** silently change a saved post's mode; the user must submit to commit the change.

---

## 2. State machine

```
                 ┌─────────────────────────────┐
                 │                             │
                 ▼                             │
        ┌────────────────┐                     │
        │     draft      │◄─────────────┐      │
        └────────────────┘              │      │
                │ submit                │      │
                │ (any tab)             │      │
                ▼                       │      │
   ┌─────────────────────────┐          │      │
   │   pending_approval      │          │      │ user edits +
   │   (only if toggle ON)   │          │      │ saves as draft
   └─────────────────────────┘          │      │ again
       │                  │             │      │
  approved             rejected         │      │
       │                  │             │      │
       │                  └─────────────┘      │
       ▼                                       │
   ┌────────────────────────────┐              │
   │   scheduled                │              │
   │   (or "publishing" if      │              │
   │    Post-now mode)          │              │
   └────────────────────────────┘              │
       │                                       │
  cron / qstash fires at scheduled_at          │
       │                                       │
       ▼                                       │
   ┌────────────────────────────┐              │
   │ bundle.social publish      │              │
   └────────────────────────────┘              │
       │                                       │
       ▼                                       │
   ┌────────────────────────────┐              │
   │   published   OR   failed  │              │
   └────────────────────────────┘              │
       │
       │ (failed only: user can retry → goes back to scheduled)
       ▼
     done
```

**Failed state**: a post enters `failed` when bundle.social returns an error or the destination platform rejects the publish. The user sees a red state badge on the post in the dashboard and a "Retry" button on the analytics modal (replacing the "Open post" button which has no URL to open yet). Retry moves it back to `scheduled` with `scheduled_at = now() + 30s` so the cron picks it up on the next tick.

---

## 3. Tab 1 — Post now

**UI**: a one-line hint ("Publish immediately to the selected profiles") and the approval toggle. Nothing else.

**On submit**:
1. Validate content (length per platform, all required affordances present — e.g. GBP requires a CTA button).
2. If approval toggle is ON → state goes to `pending_approval`, notification email + Slack to assigned approver, post is **not** published until approval.
3. If approval toggle is OFF → state goes to `publishing`, enqueue QStash job with `delay=0`, return success to UI.
4. QStash worker calls bundle.social, on success state moves to `published`.
5. UI closes composer and shows a toast: "Post published to LinkedIn, GBP" (with platform icons).

**Edge cases**:
- Network failure between UI submit and QStash enqueue → return 500 to UI, do NOT create a draft row. The user has to resubmit. Don't quietly save-as-draft on failure; that surprises people.
- bundle.social 5xx → automatic retry with exponential backoff (3 attempts: +30s, +2min, +10min). After 3 fails, state goes to `failed` and user is notified.
- Destination platform 4xx (post rejected by LinkedIn etc.) → no retry, state immediately `failed`, error message surfaced on the post-detail in the dashboard.

---

## 4. Tab 2 — Schedule

**UI**: date + time picker rows. The user can add multiple rows ("Add time" link), creating one `social_post_drafts` row per row. All rows share the same content, media, and selected profiles — they are just different `scheduled_at` values.

**Why one row per time, not "schedule this post N times"?** Because the user often wants to slightly edit each instance (different CTA wording for the morning post vs the afternoon post). Modelling them as separate drafts from the start makes editing one without affecting the others trivial. If we modelled it as "one post, N occurrences", we'd need a "detach this occurrence" UI later.

**Bulk-schedule connection**: the bulk CSV modal (§14 in the spec) is the same logic as adding many schedule rows at once. Same endpoint, same validation, same DB state. The CSV is a UX shortcut, not a separate code path.

**Defaults**:
- Date defaults to **today + 1 day**, 09:00 in the user's connected timezone (Australia/Sydney by default, override per-user in settings).
- Adding a second time row defaults to the date of the previous row + 1 day, same time.

**On submit**:
1. Validate every row independently: date in the future, time parseable, content within platform char limits.
2. If approval toggle ON → all rows go to `pending_approval` as a batch (one approver action covers all).
3. If OFF → all rows go to `scheduled` with their respective `scheduled_at`.
4. UI returns to dashboard with the affected date range refetched.

**Approval batching rule**: when a user schedules 5 rows with approval ON, the approver gets **one** email/Slack with **one** "Approve all" / "Approve individually" choice — not 5 separate emails. This is to keep the approval workflow tolerable for agency clients who get a lot of content from us.

---

## 5. Tab 3 — Publish regularly

**UI**: recurrence picker.
- "Repeat every [N] [hours|days|weeks|months]"
- "Starting on [date] at [time]"
- "Until [date]" with an "No end date" checkbox

**Examples this needs to handle**:
- Every 2 weeks, starting May 21, until Aug 21 → 7 occurrences
- Every Monday at 09:00, no end date → continuous, generates rolling forward
- Every 6 hours, starting now → daily 4x

**Implementation note (important)**:
- One **parent** `social_post_drafts` row is created with `state='recurring'` and a `recurrence_rule` field (RFC 5545 RRULE format — interop-friendly, libraries exist).
- **Six child rows** are eagerly generated on save, each with `state='scheduled'` and `parent_draft_id` set. Why six? Enough to fill an approver's inbox without overwhelming, far enough out to give the team confidence.
- A daily cron job (`/api/jobs/expand-recurring`) wakes up, finds parents whose children are all <2 weeks away, and generates the next batch.

**Why eagerly generate instead of lazily compute at cron-fire time?** Because:
1. Approval needs to happen *before* publish. If children only exist at publish time, the approver can't review them in advance.
2. The dashboard calendar needs to show future scheduled posts. It cannot show a row that doesn't exist yet.
3. Editing an upcoming occurrence ("change just the May 28 instance") is impossible if the occurrence isn't materialised.

**Editing recurring posts**:
- Editing the **parent** offers a choice: "Apply to all future occurrences" vs "This and future" vs "Just this one". This pattern is borrowed from calendar apps (Google Calendar, Apple Calendar) and people understand it.
- Editing a **child** is a one-off — the change applies only to that occurrence. The parent recurrence continues unchanged.

**Pause / resume**: the parent row gets a "Pause" action in the dashboard that flips `state` to `paused`. Children scheduled in the future are deleted. Resuming creates new children from the next valid recurrence point forward.

---

## 6. Tab 4 — Save as draft

**UI**: an optional date+time picker labelled "Plan for" (with a hint: "Planned time is a hint to your team — the post will not auto-publish").

**Behaviour**:
- State goes to `draft`, `planned_for_at` set (or NULL if the user left it blank).
- Post appears in the dashboard with a "Draft" badge, sorted by `planned_for_at` (NULL last).
- Does NOT enqueue any publish job.
- Editable indefinitely.

**Why have `planned_for_at` at all?** Because clients often draft a quarter of content at once and want to see it laid out on a calendar to identify gaps, even if they haven't decided to schedule yet. The planned-for-at gives the team a visual map without committing.

**Promotion to scheduled**: editing a draft and submitting via the Schedule tab promotes it — same row, state flips to `scheduled`, `scheduled_at` set from the Schedule-tab values, `planned_for_at` cleared.

---

## 7. Approval workflow — orthogonal to all four tabs

Every tab has an approval toggle. When ON:

1. Submit creates the row(s) but state goes to `pending_approval`, not `scheduled`/`publishing`/`recurring`.
2. The approver (configured at the company level in `social_settings.default_approver_user_id` or per-post override) receives:
   - **Email** with the post preview, "Approve" / "Reject" buttons, and a magic-link to the in-app review screen.
   - **Slack DM** if Slack integration is configured.
3. Approve → state flips forward (to `scheduled` / `publishing` / `recurring`), job is enqueued if needed.
4. Reject → state flips to `rejected`, original author gets a notification with the rejection reason. The author can edit and resubmit (which re-enters `pending_approval`).

**Default for each tier**:
- Starter: approval OFF by default.
- Growth: approval OFF by default.
- Agency: approval **ON** by default (per CLAUDE.md — every Agency post gets human review before publishing).
- Personal brand add-on: approval OFF by default.

The default is a workspace setting, not hard-coded — agencies can opt out for trusted clients, and growth-tier users can opt in for clients who want a second pair of eyes.

---

## 8. Timezones — the part everyone gets wrong

Every datetime in the system is stored as **UTC** in Postgres. UI displays in the user's connected timezone (set per user, default Australia/Sydney).

Per-platform behaviour:
- **LinkedIn**, **Facebook**, **X**, **Instagram**: bundle.social handles timezone conversion. We pass UTC, bundle.social posts at the right time.
- **GBP**: scheduled time is taken in the **business's** timezone (which can differ from the author's). When scheduling a GBP post, the UI labels the time picker with "(in business timezone: America/Chicago)" if it differs.

**DST transitions**: recurring posts that cross a DST boundary use the user's local time as authoritative. "Every Monday at 09:00" means 09:00 in their TZ, regardless of UTC offset shifting. We re-compute the next occurrence's UTC time at expansion time, not at parent-row save time.

**Past-dated submissions**: any submission with a `scheduled_at <= now()` is rejected client-side with an inline error. Don't silently shift to the next future slot — that surprises users.

---

## 9. Notifications & reminders

For each post in the pipeline, the system sends:

| Event | Recipient | Channel | Required? |
|---|---|---|---|
| Submitted for approval | Approver | Email + Slack DM | Yes |
| Approved by approver | Original author | Email | Yes |
| Rejected by approver | Original author | Email | Yes |
| Scheduled for 24h from now | Author + approver | Email digest (one per day, all upcoming posts) | Yes |
| Published successfully | Author | None (visible on dashboard) | Optional, toggleable |
| Publish failed | Author + approver | Email + Slack DM | Yes |
| Recurring schedule has < 2 occurrences left | Author | Email | Yes (so they remember to extend it) |

All emails go through SendGrid (per Opollo's locked stack). Slack DMs through the existing Slack integration on the platform layer.

---

## 10. The "Publish window" — handling minor lateness

bundle.social's queue runs every minute. If we schedule a post for 09:00:00 exactly, it actually publishes at some point between 09:00:00 and 09:00:59. This is fine for nearly every use case.

**For users who care about exact-minute publishing** (e.g. a 9am announcement that has to be 9am sharp), we surface the +/- 60s tolerance in a tooltip next to the time picker. We don't try to engineer around it — bundle.social's batch interval is what it is.

---

## 11. Bulk CSV — same logic, different entry point

The bulk CSV modal (§14) is **not a separate scheduling path**. It is a UX shortcut that adds many rows to the Schedule tab at once. The CSV parser → validates → inserts rows via the same `POST /api/platform/social/drafts/bulk` endpoint that the composer's Schedule tab uses (for 2+ rows).

**Implication**: the validation rules are shared. A CSV row that says `04/15/2025 10:00 LinkedIn` fails for the same reason a manual Schedule tab row with the same date fails — past-dated. The error message wording must match.

**CAP reuse**: when CAP generates a campaign's content, it produces a CSV in this exact format and posts it to `/api/platform/social/drafts/bulk` as the CAP system user. The CSV format, validation rules, and DB state machine are the single source of truth for the entire content pipeline.

---

## 12. What this proposal does NOT cover

- **Composer drag-to-reschedule** on the dashboard calendar — that's handled in spec §13.6 (drag-and-drop, optimistic PATCH).
- **A/B variant testing** — explicitly Phase 3, not in this composer rebuild.
- **Optimal-time recommendations** ("Post at 09:15 instead of 09:00 for higher engagement") — Phase 2 enhancement, would slot into the time picker as a chip under the input.
- **Cross-account scheduling** ("schedule this post to ten different companies at once") — Agency tier feature, separate spec.

---

## 13. Open questions for director review

1. **Six pre-generated occurrences for recurring** — is six the right number, or should it be configurable per workspace? **My recommendation**: six is fine for v1, make it configurable in a Phase 2 settings page.

2. **Approval batching** ("Approve all 5 at once" vs one-by-one) — should the default be "approve all" or "approve individually"? **My recommendation**: default to "approve all", because that's the lower-friction path for agencies who already trust the content team. Individual approval is one click further.

3. **Reject reasons** — should rejecting a post require the approver to type a reason, or is "Reject" alone enough? **My recommendation**: required reason. Forces clarity, gives the author something to work with. ~30 chars min.

4. **What happens to a post in `pending_approval` if the approver is on PTO?** Right now it just sits there. **My recommendation**: auto-fallback approver after 48h (configurable in settings); if no fallback configured, escalate to all directors via email at 48h and 72h.

5. **Past-dated bulk CSV rows** — fail the whole upload or skip them with a warning? Current spec says fail the whole upload (no partial commits). **My recommendation**: keep that. Partial commits create cleanup headaches.

These are all annotated in the spec as "open for review" — answer them before PR E (scheduling card) goes into build.
