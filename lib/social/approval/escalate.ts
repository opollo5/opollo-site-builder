import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { sendEmail } from "@/lib/email/sendgrid";
import { withHealthMonitoring } from "@/lib/platform/service-health/monitor";

/**
 * 48h / 72h / 96h approval escalation.
 *
 * 48h: reminder email to original approver.
 * 72h: escalate to company admin (platform_company_users WHERE role = 'admin').
 * 96h: auto-reject with reason "Approval timeout."
 */
export async function runEscalationCycle(): Promise<{ escalated: number; autoRejected: number }> {
  const svc = getServiceRoleClient();
  const now = Date.now();

  const h48 = new Date(now - 48 * 60 * 60 * 1000).toISOString();
  const h72 = new Date(now - 72 * 60 * 60 * 1000).toISOString();
  const h96 = new Date(now - 96 * 60 * 60 * 1000).toISOString();

  const { data: drafts, error } = await svc
    .from("social_post_drafts")
    .select("id, company_id, content, approver_user_id, created_at")
    .eq("state", "pending_approval")
    .lte("created_at", h48);

  if (error) {
    logger.warn("escalate.query_failed", { err: error.message });
    return { escalated: 0, autoRejected: 0 };
  }

  let escalated = 0;
  let autoRejected = 0;

  for (const draft of drafts ?? []) {
    const age = now - new Date(draft.created_at as string).getTime();

    if (age >= 96 * 60 * 60 * 1000) {
      // Auto-reject.
      await svc
        .from("social_post_drafts")
        .update({ state: "rejected", updated_at: new Date().toISOString() })
        .eq("id", draft.id);
      const { error: decisionErr } = await svc.from("social_post_approval_decisions").insert({
        draft_id: draft.id,
        approver_user_id: null,
        decision: "rejected",
        rejection_reason: "Approval timeout (96h).",
      });
      if (decisionErr) {
        logger.warn("escalate.decision_insert_failed", { draftId: draft.id, err: decisionErr.message });
      }
      autoRejected++;
      logger.info("escalate.auto_rejected", { draftId: draft.id });
    } else if (age >= 72 * 60 * 60 * 1000) {
      // Escalate to company admin.
      await escalateToAdmin(svc, draft.id as string, draft.company_id as string, (draft.content as string).slice(0, 120));
      escalated++;
    } else if (age >= 48 * 60 * 60 * 1000) {
      // Reminder to original approver.
      await sendReminderToApprover(svc, draft.id as string, draft.approver_user_id as string | null, (draft.content as string).slice(0, 120));
      escalated++;
    }
  }

  return { escalated, autoRejected };
}

async function escalateToAdmin(
  svc: ReturnType<typeof getServiceRoleClient>,
  draftId: string,
  companyId: string,
  excerpt: string,
): Promise<void> {
  const { data: admins } = await svc
    .from("platform_company_users")
    .select("platform_users(email)")
    .eq("company_id", companyId)
    .eq("role", "admin");

  for (const row of admins ?? []) {
    const email = (row.platform_users as { email?: string } | null)?.email;
    if (!email) continue;
    try {
      await withHealthMonitoring("sendgrid", "escalate_admin", () =>
        sendEmail({
          to: email,
          subject: "[Action required] Post awaiting approval — 72h",
          html: `<p>A post in your company has been awaiting approval for 72 hours:</p><blockquote>${excerpt}</blockquote><p>Please review it in the Opollo dashboard.</p>`,
          text: `A post has been awaiting approval for 72 hours:\n\n${excerpt}\n\nPlease review in the Opollo dashboard.`,
        }),
      );
    } catch (err) {
      logger.warn("escalate.admin_email_failed", { draftId, err: err instanceof Error ? err.message : String(err) });
    }
  }
}

async function sendReminderToApprover(
  svc: ReturnType<typeof getServiceRoleClient>,
  draftId: string,
  approverUserId: string | null,
  excerpt: string,
): Promise<void> {
  if (!approverUserId) return;
  const { data: user } = await svc
    .from("platform_users")
    .select("email")
    .eq("id", approverUserId)
    .maybeSingle();
  if (!user?.email) return;
  try {
    await withHealthMonitoring("sendgrid", "escalate_reminder", () =>
      sendEmail({
        to: user.email,
        subject: "[Reminder] Post awaiting your approval — 48h",
        html: `<p>A post has been awaiting your approval for 48 hours:</p><blockquote>${excerpt}</blockquote><p>Please review in the Opollo dashboard.</p>`,
        text: `A post has been awaiting your approval for 48 hours:\n\n${excerpt}`,
      }),
    );
  } catch (err) {
    logger.warn("escalate.reminder_email_failed", { draftId, err: err instanceof Error ? err.message : String(err) });
  }
}
