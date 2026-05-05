---
name: approval-workflow-patterns
description: Use this skill whenever working on the social post approval flow — lib/platform/social/approvals/*, app/api/platform/social/posts/[id]/submit|approve|reject|request-changes|reopen|cancel-approval, the magic-link viewer at app/review/[token]/, social_approval_requests, social_approval_events, social_approval_recipients, or social_approval_snapshots. Trigger on submitForApproval, approvePost, rejectPost, requestChanges, cancelApprovalRequest, reopenForEditing, or any reference to approval_request_id / approval token. The approval layer handles immutable snapshots and cryptographic tokens — getting it wrong creates replay attacks or orphaned approval requests.
---

# Approval Workflow Patterns

The approval layer (L2) mediates between editorial (L1) and scheduling (L3). It owns approval requests, magic-link tokens, snapshots, recipients, decisions, and audit events.

## Tables

| Table | Purpose |
|-------|---------|
| `social_approval_requests` | One open request per post at a time. Closed by `revoked_at`, `final_approved_at`, or `final_rejected_at`. |
| `social_approval_recipients` | One row per reviewer invited to an open request. |
| `social_approval_snapshots` | Immutable copy of `master_text` + `link_url` at submit time. Reviewers see this — never the live post. |
| `social_approval_events` | Audit log of every decision (approve / reject / changes_requested) with comment and reviewer identity. |

## State transitions driven by L2

The `record_approval_decision` SQL function (migration 0070) is the single atomic writer for all approval decisions. It:
1. Validates the token is non-expired and belongs to the request.
2. Closes the request (`final_approved_at` / `final_rejected_at`).
3. Advances `social_post_master.state` (predicate-guarded).
4. Writes an event row.

**Never advance master state directly from app code for approval decisions.** Always call `record_approval_decision` or use `approvePost` / `rejectPost` / `requestChanges` from `lib/platform/social/posts/transitions.ts` (which call through to the RPC).

## submitForApproval

```typescript
import { submitForApproval } from "@/lib/platform/social/posts";

const result = await submitForApproval({ postId, companyId, submittedBy });
// result.data: { approvalRequestId }
```

What `submitForApproval` does:
1. Validates post is in `draft` state.
2. Creates `social_approval_snapshots` row (immutable copy of current text + link_url).
3. Creates `social_approval_requests` row.
4. Advances master `state → 'pending_client_approval'` (predicate-guarded).
5. Returns the new `approvalRequestId` — caller uses it to invite recipients.

## Magic-link tokens

Tokens are cryptographic random UUIDs stored on `social_approval_recipients.token`. They expire after 14 days (check `expires_at < now()`). The viewer at `/review/[token]` resolves the token to the approval request and snapshot — it never reads the live post.

Token lookup pattern:
```typescript
const recipient = await svc
  .from("social_approval_recipients")
  .select("id, approval_request_id, expires_at, used_at")
  .eq("token", token)
  .maybeSingle();

if (!recipient || recipient.expires_at < new Date().toISOString()) {
  return { error: "TOKEN_EXPIRED_OR_INVALID" };
}
```

## ApprovalSnapshot — reviewers see this, not the live post

```typescript
const snapshot = await svc
  .from("social_approval_snapshots")
  .select("master_text, link_url, created_at")
  .eq("approval_request_id", approvalRequestId)
  .maybeSingle();
```

Snapshots are immutable — never updated after creation. If a post is reopened and re-submitted, a new snapshot is created.

## ApprovalSnapshot type

```typescript
export type ApprovalSnapshot = {
  masterText: string | null;
  linkUrl: string | null;
  createdAt: string;
};
```

## cancelApprovalRequest

Revokes the open request (sets `revoked_at`) and returns master to `draft`. Only the original submitter or an editor may cancel.

```typescript
import { cancelApprovalRequest } from "@/lib/platform/social/posts";

const result = await cancelApprovalRequest({ postId, companyId, reason });
// result.data: { postState: "draft" }
```

## reopenForEditing

Available when post is in `changes_requested`. Returns master to `draft` so the editor can revise.

```typescript
import { reopenForEditing } from "@/lib/platform/social/posts";

const result = await reopenForEditing({ postId, companyId });
// result.data: { postState: "draft" }
```

## Notification dispatch

After every state change that involves the approval layer, dispatch a notification:
- `submit_for_approval` → notify approvers (email + in-app)
- `post_approved` → notify submitter
- `post_rejected` → notify submitter with reviewer comment
- `post_changes_requested` → notify submitter with reviewer comment
- `cancel_approval` → no notification required (submitter-initiated)

Use `lib/platform/social/notifications.ts`; never call SendGrid directly from the approval layer.

## Key invariants

- At most one `social_approval_requests` row with `revoked_at IS NULL AND final_approved_at IS NULL AND final_rejected_at IS NULL` per post at any time. Enforced by application logic in `submitForApproval` (revoke any open request before creating a new one).
- `social_approval_snapshots` has exactly one row per `approval_request_id`.
- All state advances are predicate-guarded — if the predicate misses, the transition is a no-op and the caller returns `INVALID_STATE`.
- `record_approval_decision` is SECURITY DEFINER — it runs with elevated permissions to advance master state atomically without exposing the service role to the browser.

## Route gating

| Action | Required permission |
|--------|---------------------|
| Submit for approval | `submit_for_approval` (editor+) |
| Approve | `approve_post` (approver+) |
| Reject | `approve_post` (approver+) |
| Request changes | `approve_post` (approver+) |
| Cancel approval | `submit_for_approval` (editor+) |
| Reopen for editing | `edit_post` (editor+) |

Magic-link reviewer has no session — they authenticate via token only. The `/review/[token]` route does not call `requireCanDoForApi`.
