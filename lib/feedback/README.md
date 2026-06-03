# lib/feedback — In-App Feedback & Issue Triage

Bug-tracking module. Consumes the platform layer for identity, company scoping,
and notifications. **Never** reads `platform_company_users` directly — always
through `lib/platform/auth` public helpers.

## Directory structure

```
lib/feedback/
├── types/index.ts        CallerContext, TicketStatus, FeedbackTicket shapes
├── tickets/
│   ├── create.ts         validate + insert, event write, notification dispatch
│   ├── assign.ts         assign/reassign (staff only; assignee must be staff)
│   ├── update-status.ts  state machine + CallerContext guard (§1, §7 of spec)
│   ├── comments.ts       two-way thread add/list; is_staff derived server-side
│   └── queries.ts        list/get (member: own company; staff: all)
├── capture/
│   ├── selector.ts       stable-selector resolution (shared client/server type)
│   ├── screenshot.ts     signed upload + signed-on-read resolution
│   └── annotate.ts       overlay shapes persisted with the screenshot
└── repo-bridge/
    ├── pull.ts           Supabase → docs/bugs/<slug>.md
    └── push.ts           docs/bugs/<slug>.md status/PR → Supabase (impl status only)
```

## Layer rules

- Feature logic stays in `lib/feedback/`; reach into `lib/platform/` only
  via public helpers (`isOpolloStaff`, `isCompanyMember`, `dispatch`, etc.).
- `lib/feedback/` never imports `@sendgrid/mail` — notifications go through
  `lib/platform/notifications/dispatch.ts`.
- Screenshots: store the object path; sign on read via `screenshot.ts`.
- The `CallerContext` guard in `update-status.ts` is the governance boundary —
  automation may only write `in_progress` / `fixed`; customers only the
  controlled reopen; humans can write everything.

## Notification events (platform_notification_type enum)

Added in migration 0179:
- `ticket_created`
- `ticket_assigned`
- `ticket_comment_added`
- `ticket_status_changed`
- `ticket_reopened_by_customer`
