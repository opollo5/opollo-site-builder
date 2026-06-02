# Proofing Architecture Recon

Date: 2026-06-02
Scope: Magic-link tokens, approval workflows, content versioning, notifications, platform identity.
Status: Phase 1 active; Phase 2 in migration 0173.

## SECTION 1: MAGIC LINKS

### 1a. Token Generation
- Location: lib/platform/invitations/tokens.ts
- Generation: 32 random bytes → hex-encoded to 64-char string
- Hashing: SHA-256 hex digest
- Storage: Only hash persisted on social_approval_recipients.token_hash
- Raw token: Generated once, returned to caller, discarded after
- TTL: 14 days (expires_at on social_approval_requests)

### 1b. /approve/[token] Route
- Location: app/approve/[token]/page.tsx
- Auth: Token-only; public route; no session required
- Three states: Invalid → ExpiredPanel | InvalidLink
              Finalised → "Already resolved"
              Open → snapshot + decision form
- Snapshot: Immutable JSON on request.snapshot_payload (no separate table)

### 1c. Decision Endpoint
- Location: app/api/approve/[token]/decision/route.ts
- Auth: Token hash comparison; no canDo gate
- Comment: Required for rejected/changes_requested decisions
- Post-decision: image_batch → onGatePass/onGateReject; post → dispatch()

### 1d. OTP Scaffolding
- Columns present: requires_otp, otp_code_hash, otp_expires_at
- Status: Schema only; no issuance/validation code

### 1e. Connection Reconnect
- Pattern: Interactive OAuth; editor+ permission
- No magic-link reconnect

### 1f. Login Flow
- Password + optional 2FA
- No passwordless magic-link login
- Invitations use magic links (/invite/[token]) for onboarding only

## SECTION 2: APPROVAL CORE

### 2a. Schemas

social_approval_requests (0070 + 0172 + 0173):
  id, post_master_id (nullable 0172), company_id, approval_rule
  snapshot_payload (JSONB), expires_at, revoked_at
  final_approved_by_user_id, final_approved_by_email, final_approved_by_name
  final_approved_at, final_rejected_at
  subject_type (0172), subject_id (0172)
  reminder_day0/3/7/14_sent_at (0173), admin_alerted_at (0173)
  created_at

social_approval_recipients (0070):
  id, approval_request_id, email, name, platform_user_id
  token_hash (SHA-256), requires_otp, otp_code_hash, otp_expires_at
  revoked_at, created_at

social_approval_events (0070):
  id, approval_request_id, recipient_id, event_type
  platform, comment_text, actor_user_id
  bound_identity_name, bound_identity_email, ip_address, user_agent
  occurred_at

image_generation_batches (0172):
  approval_status: 'none'|'pending_review'|'approved'|'rejected'|'escalated_to_admin'
  review_round: INT DEFAULT 0

social_post_drafts (0172):
  workflow_state: 'pending_copy_review'|'rework_copy'|'in_image_production'|
                  'pending_image_review'|'rework_image'|'pending_final_signoff'|
                  'ready_to_schedule'|'escalated_to_admin'

company_workflow_gates (0172):
  id, company_id, gate_type (enum), enabled, pass_rule, timeout_days, auto_schedule
  UNIQUE (company_id, gate_type)

company_workflow_gate_approvers (0172):
  id, gate_id, platform_user_id (nullable), external_email (nullable)
  CHECK (platform_user_id IS NOT NULL OR external_email IS NOT NULL)

### 2b. RPC: record_approval_decision
- File: supabase/migrations/0072_record_approval_decision_fn.sql
- Validates recipient + request state
- Inserts event row
- Evaluates approval_rule; decides finalisation
- Updates request + post state atomically
- Returns { request_id, post_id, post_state, finalised, event_id }
- Error codes: P0001 = INVALID_STATE, P0002 = NOT_FOUND

### 2c. V1 vs V2 Pipelines
V1 (social_post_master):
  State: draft → pending_client_approval → approved → scheduled → publishing → published
  Links to: social_post_variant, social_approval_requests

V2 (social_post_drafts):
  State: scheduled → publishing → published
  Publish via: cron (claim_due_drafts)
  workflow_state: added 0172

### 2d. Content Versioning
- Model: No versioning; single mutable row
- draft_version: INT (optimistic concurrency, not version history)
- No parent_id/supersedes; no version history table
- Revisions: archive + create new
- Only approval snapshot immutable

## SECTION 3: NOTIFICATIONS

### 3a. dispatch()
File: lib/platform/notifications/dispatch.ts
Signature: dispatch(payload: DispatchPayload) → DispatchResult
Events: approval_requested, approval_decided, changes_requested, post_published, post_failed, others
Channels: email | in_app+email per event

### 3b. SendGrid
File: lib/email/sendgrid.ts
Behavior: First attempt + one retry on 5xx (250ms backoff)
Email log: every send (success + failure)
Staging redirect: STAGING env override

### 3c. Approval Callbacks (Phase 2)
File: lib/platform/workflow/approval-callbacks.ts
enqueueApprovalCallbacks: 4 QStash messages (day-3, day-7, day-14 + escalation)
handleReminderCallback: Atomic UPDATE reminder_dayN_sent_at; emails internal approvers only
handleEscalateCallback: Atomic UPDATE admin_alerted_at; logs critical error
Limitation: External approvers (platform_user_id IS NULL) get no reminders; Phase-2+

## SECTION 4: PLATFORM / IDENTITY

### 4a. Roles & Permissions
Enum: admin (4) > approver (3) > editor (2) > viewer (1)

ACTION_MIN_ROLE:
  manage_users: admin
  manage_connections: admin
  reconnect_connection: editor
  create_post: editor
  submit_for_approval: editor
  approve_post: approver
  schedule_post: approver
  view_calendar: viewer

### 4b. UI Surfaces
PlatformCompanyDetail: tabs + "workflow" tab (WorkflowGatesTab)
WorkflowStatusDrawer: sheet showing approval spine (copy_review, image_review, final_signoff, scheduled)
BatchResultsClient: carousel + workflow button + comment dialogs

### 4c. Route Pattern
Example: app/api/platform/image/jobs/[id]/select/route.ts
1. Load context (owner company)
2. Gate: requireCanDoForApi(companyId, action)
3. Parse + validate (Zod)
4. Execute (service-role)
5. Return { ok, data, timestamp }

## SECTION 5: CRITICAL CONTRADICTIONS

1. NO SNAPSHOT TABLE
   Reality: snapshot_payload is JSONB on request row (no separate table)
   Impact: No JOIN; no per-request snapshot audit

2. NO CONTENT VERSIONING
   Reality: Single mutable row; revisions = archive + create new
   Impact: No parent_id/supersedes; only snapshot immutable

3. PARALLEL V1/V2 PIPELINES
   Reality: V1 (master → variant → schedule) & V2 (draft → scheduled → cron)
   Impact: Approvals on V1 only; workflow_state on V2 only

4. post_master_id NULLABLE (0172)
   Reality: Null for image_batch subject_type
   Impact: RPC no-ops on post state when post_master_id IS NULL

5. OTP SCAFFOLDING ONLY
   Reality: Columns present; no issuance/validation
   Impact: Phase-2+ feature

6. EXTERNAL APPROVER EMAIL LIMITATION
   Reality: Day-3/7/14 reminders only to platform_user_id IS NOT NULL
   Impact: External approvers get invite only; token regeneration Phase-2+

7. RAW TOKEN NOT PERSISTED
   Reality: Only hash stored; raw token discarded after return to caller
   Impact: Cannot resend magic link without re-invoking API

## KEY FINDINGS FOR BUILD BRIEFS

1. snapshot_payload is JSONB on request row, not separate table
2. post_master_id is nullable (0172); RPC handles both posts and batches
3. V1 and V2 pipelines run in parallel; approvals on V1 only
4. No content versioning; only approval snapshot immutable
5. Raw tokens not re-sendable; external approver reminders Phase-2+
