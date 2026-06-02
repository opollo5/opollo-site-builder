import "server-only";

import { sendEmail } from "@/lib/email/sendgrid";
import { renderSocialApprovalReminderEmail } from "@/lib/email/templates/social-approval-reminder";
import { logger } from "@/lib/logger";
import { getQstashClient } from "@/lib/qstash";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Phase-2 workflow: reminder + escalation ladder for social_approval_requests.
//
// QStash messages are published at:
//   - Day 3 → /api/platform/approvals/callbacks/reminder  (body: { approvalRequestId, day: 3 })
//   - Day 7 → /api/platform/approvals/callbacks/reminder  (body: { approvalRequestId, day: 7 })
//   - Day 14 → /api/platform/approvals/callbacks/reminder (body: { approvalRequestId, day: 14 })
//   - Day 14 → /api/platform/approvals/callbacks/escalate (body: { approvalRequestId })
//
// Idempotency pattern matches lib/platform/invitations/callbacks.ts:
//   Atomic UPDATE ... WHERE reminder_dayN_sent_at IS NULL — only the
//   first concurrent fire claims the slot; subsequent fires no-op.
//
// Phase-2 limitation:
//   External approvers (platform_user_id IS NULL) are NOT emailed on day
//   3/7/14 because the raw token used to construct their magic link is
//   not stored after creation (only the hash). Token regeneration is
//   future work. Day-0 invite emails are sent from createBatchApprovalRequest()
//   while the raw token is still in scope.
// ---------------------------------------------------------------------------

export type ApprovalCallbackResult = {
  outcome:
    | "noop_already_handled"
    | "noop_not_open"
    | "noop_not_found"
    | "dispatched"
    | "internal_error";
  approvalRequestId: string;
  message?: string;
};

// ---------------------------------------------------------------------------
// DB row shapes. We hand-write these rather than relying on generated
// Supabase types so the code compiles before supabase gen is re-run.
// ---------------------------------------------------------------------------

interface ApprovalRequestRow {
  id: string;
  company_id: string;
  revoked_at: string | null;
  final_approved_at: string | null;
  final_rejected_at: string | null;
  reminder_day0_sent_at: string | null;
  reminder_day3_sent_at: string | null;
  reminder_day7_sent_at: string | null;
  reminder_day14_sent_at: string | null;
  admin_alerted_at: string | null;
  expires_at: string | null;
}

interface ApprovalRecipientRow {
  id: string;
  approval_request_id: string;
  email: string;
  platform_user_id: string | null;
  revoked_at: string | null;
}

interface CompanyRow {
  id: string;
  name: string;
  timezone: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_SECONDS = 86_400;
const REMINDER_DAYS = [3, 7, 14] as const;

function reminderColumn(day: 3 | 7 | 14): keyof ApprovalRequestRow {
  return `reminder_day${day}_sent_at` as keyof ApprovalRequestRow;
}

function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "")
  );
}

// ---------------------------------------------------------------------------
// enqueueApprovalCallbacks
//
// Called from createBatchApprovalRequest() after a successful insert.
// Publishes 4 QStash messages: 3 reminders + 1 escalation at day 14.
// QStash failures are logged but do NOT fail the parent request.
// ---------------------------------------------------------------------------

export async function enqueueApprovalCallbacks(params: {
  approvalRequestId: string;
  timeoutDays: number;
  origin: string;
}): Promise<void> {
  const client = getQstashClient();
  if (!client) {
    logger.info("workflow.approvals.enqueue.skipped_no_qstash", {
      approval_request_id: params.approvalRequestId,
    });
    return;
  }

  const base = params.origin.replace(/\/+$/, "");
  const reminderUrl = `${base}/api/platform/approvals/callbacks/reminder`;
  const escalateUrl = `${base}/api/platform/approvals/callbacks/escalate`;

  const publishes = REMINDER_DAYS.map((day) =>
    client
      .publishJSON({
        url: reminderUrl,
        body: { approvalRequestId: params.approvalRequestId, day },
        delay: day * DAY_SECONDS,
        deduplicationId: `approval-reminder-day${day}-${params.approvalRequestId}`,
      })
      .then((res) => {
        logger.info("workflow.approvals.enqueue.reminder_queued", {
          approval_request_id: params.approvalRequestId,
          day,
          message_id: (res as { messageId?: string }).messageId ?? null,
        });
      })
      .catch((err: unknown) => {
        logger.error("workflow.approvals.enqueue.reminder_failed", {
          approval_request_id: params.approvalRequestId,
          day,
          err: err instanceof Error ? err.message : String(err),
        });
      }),
  );

  // Day-14 escalation is a separate message so it can fire independently
  // of the reminder (different handler, different dedup key).
  const escalatePublish = client
    .publishJSON({
      url: escalateUrl,
      body: { approvalRequestId: params.approvalRequestId },
      delay: 14 * DAY_SECONDS,
      deduplicationId: `approval-escalate-${params.approvalRequestId}`,
    })
    .then((res) => {
      logger.info("workflow.approvals.enqueue.escalation_queued", {
        approval_request_id: params.approvalRequestId,
        message_id: (res as { messageId?: string }).messageId ?? null,
      });
    })
    .catch((err: unknown) => {
      logger.error("workflow.approvals.enqueue.escalation_failed", {
        approval_request_id: params.approvalRequestId,
        err: err instanceof Error ? err.message : String(err),
      });
    });

  await Promise.all([...publishes, escalatePublish]);
}

// ---------------------------------------------------------------------------
// handleReminderCallback
//
// Invoked by /api/platform/approvals/callbacks/reminder.
// Sends a reminder email to internal approvers (platform_user_id IS NOT NULL).
// External approvers are skipped (Phase-2 limitation; see module header).
// ---------------------------------------------------------------------------

export async function handleReminderCallback(params: {
  approvalRequestId: string;
  day: 3 | 7 | 14;
}): Promise<ApprovalCallbackResult> {
  const svc = getServiceRoleClient();

  // 1. Fetch the approval request.
  const { data: requestData, error: requestErr } = await svc
    .from("social_approval_requests")
    .select(
      "id, company_id, revoked_at, final_approved_at, final_rejected_at, reminder_day0_sent_at, reminder_day3_sent_at, reminder_day7_sent_at, reminder_day14_sent_at, admin_alerted_at, expires_at",
    )
    .eq("id", params.approvalRequestId)
    .maybeSingle();

  if (requestErr) {
    logger.error("workflow.approvals.reminder.lookup_failed", {
      approval_request_id: params.approvalRequestId,
      day: params.day,
      err: requestErr.message,
    });
    return {
      outcome: "internal_error",
      approvalRequestId: params.approvalRequestId,
      message: requestErr.message,
    };
  }

  if (!requestData) {
    return {
      outcome: "noop_not_found",
      approvalRequestId: params.approvalRequestId,
    };
  }

  const request = requestData as ApprovalRequestRow;

  // 2. Only send if request is still open.
  if (request.revoked_at || request.final_approved_at || request.final_rejected_at) {
    logger.info("workflow.approvals.reminder.noop_not_open", {
      approval_request_id: params.approvalRequestId,
      day: params.day,
    });
    return {
      outcome: "noop_not_open",
      approvalRequestId: params.approvalRequestId,
    };
  }

  // 3. Check if already sent (fast path before the atomic claim).
  const col = reminderColumn(params.day);
  if (request[col]) {
    return {
      outcome: "noop_already_handled",
      approvalRequestId: params.approvalRequestId,
    };
  }

  // 4. Atomic exactly-once claim.
  const updatePayload: Record<string, string> = {
    [col]: new Date().toISOString(),
  };

  const claim = await svc
    .from("social_approval_requests")
    .update(updatePayload)
    .eq("id", params.approvalRequestId)
    .is(col, null)
    .select("id")
    .maybeSingle();

  if (claim.error) {
    logger.error("workflow.approvals.reminder.claim_failed", {
      approval_request_id: params.approvalRequestId,
      day: params.day,
      err: claim.error.message,
    });
    return {
      outcome: "internal_error",
      approvalRequestId: params.approvalRequestId,
      message: claim.error.message,
    };
  }

  if (!claim.data) {
    // Another concurrent fire claimed it first.
    return {
      outcome: "noop_already_handled",
      approvalRequestId: params.approvalRequestId,
    };
  }

  // 5. Fetch internal recipients (platform_user_id IS NOT NULL, not revoked).
  const { data: recipients, error: recipientsErr } = await svc
    .from("social_approval_recipients")
    .select("id, approval_request_id, email, platform_user_id, revoked_at")
    .eq("approval_request_id", params.approvalRequestId)
    .is("revoked_at", null)
    .not("platform_user_id", "is", null);

  if (recipientsErr) {
    logger.error("workflow.approvals.reminder.recipients_lookup_failed", {
      approval_request_id: params.approvalRequestId,
      day: params.day,
      err: recipientsErr.message,
    });
    // Claim was already taken; return dispatched to avoid retry surfacing
    // a transient DB error as a hard failure.
    return {
      outcome: "internal_error",
      approvalRequestId: params.approvalRequestId,
      message: recipientsErr.message,
    };
  }

  // 6. Fetch company name for email copy.
  const { data: companyData } = await svc
    .from("platform_companies")
    .select("id, name, timezone")
    .eq("id", request.company_id)
    .maybeSingle();

  const company = companyData as CompanyRow | null;
  const companyName = company?.name ?? "Your company";
  const reviewUrl = `${siteUrl()}/company/social/calendar`;

  const dueDateDisplay = request.expires_at
    ? formatDueDate(request.expires_at, company?.timezone ?? null)
    : "—";

  // 7. Send reminder to each internal approver.
  const internalRecipients = (recipients ?? []) as ApprovalRecipientRow[];

  if (internalRecipients.length === 0) {
    logger.info("workflow.approvals.reminder.no_internal_recipients", {
      approval_request_id: params.approvalRequestId,
      day: params.day,
    });
    return {
      outcome: "dispatched",
      approvalRequestId: params.approvalRequestId,
      message: "no internal recipients to email",
    };
  }

  for (const recipient of internalRecipients) {
    const { subject, html, text } = renderSocialApprovalReminderEmail({
      recipient_email: recipient.email,
      recipient_name: null,
      company_name: companyName,
      review_url: reviewUrl,
      due_date_display: dueDateDisplay,
      version_label: "Version 1",
      reviewer_role: "Approver",
      day: params.day,
    });

    const send = await sendEmail({ to: recipient.email, subject, html, text });
    if (!send.ok) {
      logger.warn("workflow.approvals.reminder.email_failed", {
        approval_request_id: params.approvalRequestId,
        day: params.day,
        recipient: recipient.email,
        err: send.error.message,
      });
    } else {
      logger.info("workflow.approvals.reminder.email_sent", {
        approval_request_id: params.approvalRequestId,
        day: params.day,
        recipient: recipient.email,
      });
    }
  }

  return {
    outcome: "dispatched",
    approvalRequestId: params.approvalRequestId,
  };
}

// ---------------------------------------------------------------------------
// handleEscalateCallback
//
// Invoked by /api/platform/approvals/callbacks/escalate at day 14.
// Logs a CRITICAL error to alert Opollo admins that a request has been
// open for 14 days without resolution. Admin email dispatch is Phase-2
// pragmatic: log.error is the alert surface until a dedicated admin
// notification flow ships.
// ---------------------------------------------------------------------------

export async function handleEscalateCallback(params: {
  approvalRequestId: string;
}): Promise<ApprovalCallbackResult> {
  const svc = getServiceRoleClient();

  // 1. Fetch the approval request.
  const { data: requestData, error: requestErr } = await svc
    .from("social_approval_requests")
    .select(
      "id, company_id, revoked_at, final_approved_at, final_rejected_at, admin_alerted_at, expires_at",
    )
    .eq("id", params.approvalRequestId)
    .maybeSingle();

  if (requestErr) {
    logger.error("workflow.approvals.escalate.lookup_failed", {
      approval_request_id: params.approvalRequestId,
      err: requestErr.message,
    });
    return {
      outcome: "internal_error",
      approvalRequestId: params.approvalRequestId,
      message: requestErr.message,
    };
  }

  if (!requestData) {
    return {
      outcome: "noop_not_found",
      approvalRequestId: params.approvalRequestId,
    };
  }

  const request = requestData as ApprovalRequestRow;

  // 2. Only escalate if request is still open.
  if (request.revoked_at || request.final_approved_at || request.final_rejected_at) {
    logger.info("workflow.approvals.escalate.noop_not_open", {
      approval_request_id: params.approvalRequestId,
    });
    return {
      outcome: "noop_not_open",
      approvalRequestId: params.approvalRequestId,
    };
  }

  // 3. Fast-path idempotency check.
  if (request.admin_alerted_at) {
    return {
      outcome: "noop_already_handled",
      approvalRequestId: params.approvalRequestId,
    };
  }

  // 4. Atomic exactly-once claim.
  const claim = await svc
    .from("social_approval_requests")
    .update({ admin_alerted_at: new Date().toISOString() })
    .eq("id", params.approvalRequestId)
    .is("admin_alerted_at", null)
    .select("id")
    .maybeSingle();

  if (claim.error) {
    logger.error("workflow.approvals.escalate.claim_failed", {
      approval_request_id: params.approvalRequestId,
      err: claim.error.message,
    });
    return {
      outcome: "internal_error",
      approvalRequestId: params.approvalRequestId,
      message: claim.error.message,
    };
  }

  if (!claim.data) {
    return {
      outcome: "noop_already_handled",
      approvalRequestId: params.approvalRequestId,
    };
  }

  // 5. Alert Opollo admins via a CRITICAL log entry.
  // Phase-2: log.error is the alert surface. A dedicated admin email
  // dispatch (dispatch({ event: "approval_escalated" })) ships in Phase 3
  // once the NotificationEvent enum and EVENT_CHANNELS are extended.
  logger.error("workflow.approvals.escalate.admin_alert", {
    is_critical: true,
    approval_request_id: params.approvalRequestId,
    company_id: request.company_id,
    expires_at: request.expires_at,
    message:
      "Approval request has been open for 14 days without resolution. Manual intervention required.",
  });

  return {
    outcome: "dispatched",
    approvalRequestId: params.approvalRequestId,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDueDate(iso: string, timezone: string | null): string {
  const d = new Date(iso);
  return d.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: timezone ?? "UTC",
  });
}
