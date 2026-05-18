import "server-only";

import { sendEmail } from "@/lib/email/sendgrid";
import { withHealthMonitoring } from "@/lib/platform/service-health/monitor";
import { logger } from "@/lib/logger";

interface NotifyApproverParams {
  draftId: string;
  approverEmail: string;
  authorName: string;
  contentExcerpt: string;
  reviewUrl: string;
}

interface NotifyRejectionParams {
  draftId: string;
  authorEmail: string;
  rejectionReason: string;
  approverName: string;
}

export async function notifyApprover(params: NotifyApproverParams): Promise<void> {
  await withHealthMonitoring("sendgrid", "notify_approver", async () => {
    const subject = `[Action required] Post approval request from ${params.authorName}`;
    const html = `
<h2>Post approval request</h2>
<p>${params.authorName} has requested your approval for a social post.</p>
<blockquote>${params.contentExcerpt}</blockquote>
<p><a href="${params.reviewUrl}">Review and approve or reject →</a></p>
<p>This link expires in 14 days.</p>
`.trim();
    const text = `${params.authorName} has requested your approval for a social post.\n\n${params.contentExcerpt}\n\nReview: ${params.reviewUrl}`;
    await sendEmail({ to: params.approverEmail, subject, html, text });
  });
}

export async function notifyRejection(params: NotifyRejectionParams): Promise<void> {
  try {
    await withHealthMonitoring("sendgrid", "notify_rejection", async () => {
      const subject = "[Opollo] Your post was not approved";
      const html = `
<h2>Post not approved</h2>
<p>${params.approverName} did not approve your post.</p>
<p><strong>Reason:</strong> ${params.rejectionReason}</p>
`.trim();
      const text = `${params.approverName} did not approve your post.\n\nReason: ${params.rejectionReason}`;
      await sendEmail({ to: params.authorEmail, subject, html, text });
    });
  } catch (err) {
    logger.warn("approval.notify_rejection_failed", {
      draftId: params.draftId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

// Optional Slack DM fallback — non-blocking, best-effort.
export function notifyApproverSlack(webhookUrl: string, params: NotifyApproverParams): void {
  void fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `📋 *Approval request* from ${params.authorName}\n${params.contentExcerpt.slice(0, 120)}\n${params.reviewUrl}`,
    }),
  }).catch((err) =>
    logger.warn("approval.slack_notify_failed", { err: err instanceof Error ? err.message : String(err) }),
  );
}
