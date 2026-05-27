# Product decisions — locked

Decisions locked as of 2026-05-27. These are canonical product decisions
that resolve previously-open questions in `docs/inventory/`. Each
decision is the authoritative answer for any dependent code change in
this workstream. Do not re-open without a new explicit signal from Steven.

---

## D1 — Platform access model

- Opollo staff (`@opollo.com` email domain) have full platform access
  across ALL customer companies via `is_opollo_staff = true` on
  `platform_users`. RLS policies grant them read/write bypass.
- Every staff write action is audit-logged (minimum fields: see D4).
- Customer users are scoped to ONE company per account. The
  `UNIQUE (user_id)` constraint on `platform_company_users` enforces
  this at the DB level; `sendInvitation` enforces it at the application
  level via `ACTIVE_MEMBERSHIP_EXISTS` for non-staff invitees.
- A user at `rodin.com` only ever sees `rodin.com` data. They cannot
  be cross-tenant invited; they would need a separate account.
- Customer admins can invite users within their own company.
- Opollo staff can invite users into any customer company (e.g. for
  client onboarding) — checked at the API layer via
  `requireCanDoForApi(..., 'manage_invitations')` which is OR'd with
  `is_opollo_staff()` in RLS.
- Feature gating: Opollo staff toggle per-customer OR customer
  subscription unlocks features (separate feature-flag workstream).
- User removal: HARD DELETE. Email is free to reuse afterward. (FIX-2)

## D2 — Bulk CSV permissions

- Bulk CSV upload requires `schedule_post` permission (admin/manager).
  Editors cannot use bulk CSV.
- **Already shipped** in PR #1084. No further action.

## D3 — V1→V2 post model migration

- Sunset V1 (`social_post_master`, `social_post_variant`,
  `social_schedule_entries`). Migrate all functionality to V2
  (`social_post_drafts`).
- Separate dedicated workstream — Steven fires a scoping prompt.
- **Not in scope for the FIX-1–FIX-5 workstream.**

## D4 — Staff audit log fields

Minimum fields for `platform_staff_audit_log`:

| Field | Type | Note |
|-------|------|------|
| `timestamp` | `TIMESTAMPTZ` | UTC, NOT NULL, DEFAULT now() |
| `staff_user_id` | `UUID` | FK → platform_users |
| `staff_email` | `TEXT` | Denormalised for readability |
| `company_id` | `UUID` | FK → platform_companies (nullable — global actions) |
| `company_name` | `TEXT` | Denormalised for readability |
| `action` | `TEXT` | e.g. `invite.sent`, `user.removed`, `staff_grant.auto` |
| `resource_id` | `TEXT` | Affected row UUID |
| `ip_address` | `TEXT` | Captured from request headers |

Explicitly excluded:
- No before/after data diff
- No read-action logging
- No mandatory reason field
- No customer email notification per action

## D5 — External approver authentication

- Magic-link token in the review URL IS the auth credential for
  external approvers.
- Approvers with existing Opollo accounts can also log in to access
  the same review.
- Email channel is treated as trusted.
- Token validation requirements:
  - Cryptographically signed
  - Expires after 7 days OR when the post publishes (whichever first)
  - One-time use for the final Approve/Reject submission
- Approver identity captured from the email the link was originally
  sent to.

## D6 — V1/V2 state enum migration mapping

**Resolved 2026-05-27 (conservative path — lowest risk, fully reversible).**

V1 uses a Postgres ENUM (`social_post_state`). V2 uses constrained TEXT.
State mapping applied by the backfill script (PR-04) and any V1→V2 route
cutover:

| V1 state | V2 state | Rationale |
|----------|----------|-----------|
| `draft` | `draft` | Identical concept |
| `pending_client_approval` | `pending_approval` | Direct equivalent; renamed |
| `approved` | `scheduled` (with `scheduled_at = NULL`) | V2 skips the approved-not-yet-scheduled intermediate; editor must set schedule |
| `changes_requested` | `pending_approval` | Conservative: requires re-review rather than silently advancing |
| `pending_msp_release` | `pending_approval` | Conservative: requires explicit re-approval before going live |
| `rejected` | `rejected` | Terminal in both models |
| `scheduled` | `scheduled` | Direct equivalent |
| `publishing` | `publishing` | Direct equivalent |
| `published` | `published` | Direct equivalent |

**Consequences:**
- Posts previously in `changes_requested` or `pending_msp_release` will appear
  in the approver's queue again after migration. This is intentional — they were
  mid-review and re-approval is safer than silent state advancement.
- `pending_msp_release` is not being rebuilt in V2 (see PLAN.md Out of Scope
  §6). If MSP batch-release gating is needed in V2, that is a future workstream.
- V2 `recurring` and `paused` states are V2-only; no V1 equivalent exists.
  The backfill script never writes these states.
- V2 `failed` and `cancelled` are V2-only cleanup states; not produced by
  backfill.
