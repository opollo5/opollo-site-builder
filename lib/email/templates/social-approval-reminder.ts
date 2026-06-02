import "server-only";

import { renderBaseEmail, escapeHtml } from "./base";

// ---------------------------------------------------------------------------
// Phase-2 workflow: reminder emails sent at day 3, 7, and 14 after an
// approval request is created, via QStash delayed callbacks.
//
// External approvers are NOT emailed (raw token not recoverable after
// creation — Phase-2 limitation; token regeneration is future work).
// Internal approvers (platform_user_id IS NOT NULL) receive these
// reminders linking back to the platform's social calendar.
//
// Loss-aversion copy on day 14 (L11): warns about review window
// closing; content is never deleted.
// ---------------------------------------------------------------------------

export interface SocialApprovalReminderEmailInput {
  recipient_email: string;
  recipient_name: string | null;
  company_name: string;
  // For internal approvers: link to /company/social/calendar or similar.
  review_url: string;
  due_date_display: string;
  version_label: string;
  reviewer_role: string;
  day: 3 | 7 | 14;
}

export function renderSocialApprovalReminderEmail(
  input: SocialApprovalReminderEmailInput,
): { subject: string; html: string; text: string } {
  const { subject, leadHtml, leadText, finalNoteHtml, finalNoteText } =
    copyForDay(input);

  const greeting = input.recipient_name?.trim()
    ? escapeHtml(input.recipient_name.trim())
    : "Hi";

  const bodyHtml = `
    <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#0f172a;">
      ${greeting},
    </p>
    <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#0f172a;">
      ${leadHtml}
    </p>
    <p style="margin:0 0 6px 0;font-size:13px;color:#64748b;"><strong>Company:</strong> ${escapeHtml(input.company_name)}</p>
    <p style="margin:0 0 6px 0;font-size:13px;color:#64748b;"><strong>Version:</strong> ${escapeHtml(input.version_label)}</p>
    <p style="margin:0 0 6px 0;font-size:13px;color:#64748b;"><strong>Your role:</strong> ${escapeHtml(input.reviewer_role)}</p>
    <p style="margin:0 0 16px 0;font-size:13px;color:#64748b;"><strong>Due by:</strong> ${escapeHtml(input.due_date_display)}</p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:16px 0;">
      <tr>
        <td style="border-radius:6px;background-color:#16a34a;">
          <a href="${escapeHtml(input.review_url)}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">
            Review now
          </a>
        </td>
      </tr>
    </table>
    ${
      finalNoteHtml
        ? `<p style="margin:16px 0 0 0;font-size:13px;line-height:1.5;color:#dc2626;">${finalNoteHtml}</p>`
        : ""
    }
    <p style="margin:${finalNoteHtml ? "8px" : "16px"} 0 0 0;font-size:12px;line-height:1.5;color:#64748b;">
      If you didn't expect this request, you can safely ignore the email.
    </p>
  `;

  const textBody = [
    `${input.recipient_name?.trim() ?? "Hi"},`,
    ``,
    leadText,
    ``,
    `Company: ${input.company_name}`,
    `Version: ${input.version_label}`,
    `Your role: ${input.reviewer_role}`,
    `Due by: ${input.due_date_display}`,
    ``,
    `Review now: ${input.review_url}`,
    ...(finalNoteText ? [``, finalNoteText] : []),
    ``,
    `If you didn't expect this request, you can safely ignore the email.`,
  ].join("\n");

  const { html, text } = renderBaseEmail({
    heading: subject,
    bodyHtml,
    bodyText: textBody,
    footerNote: "Sent automatically by Opollo.",
  });

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Per-day copy. Day 14 uses loss-aversion framing (L11).
// ---------------------------------------------------------------------------

type DayCopy = {
  subject: string;
  leadHtml: string;
  leadText: string;
  finalNoteHtml: string | null;
  finalNoteText: string | null;
};

function copyForDay(input: SocialApprovalReminderEmailInput): DayCopy {
  const co = escapeHtml(input.company_name);
  const due = escapeHtml(input.due_date_display);

  switch (input.day) {
    case 3:
      return {
        subject: `Reminder: Your approval is needed — ${input.company_name}`,
        leadHtml: `<strong>${co}</strong> is still waiting for your review on a social post.`,
        leadText: `${input.company_name} is still waiting for your review on a social post.`,
        finalNoteHtml: null,
        finalNoteText: null,
      };

    case 7:
      return {
        subject: `Second reminder: Content awaiting your approval — ${input.company_name}`,
        leadHtml: `<strong>${co}</strong> is still waiting for your review. The deadline is approaching.`,
        leadText: `${input.company_name} is still waiting for your review. The deadline is approaching.`,
        finalNoteHtml: null,
        finalNoteText: null,
      };

    case 14:
      return {
        subject: `Final notice: You have 7 more days before losing access — ${input.company_name}`,
        leadHtml: `This is your final reminder. After <strong>${due}</strong>, you will lose access to review this content.`,
        leadText: `This is your final reminder. After ${input.due_date_display}, you will lose access to review this content.`,
        finalNoteHtml: `The content will not be deleted, but your review window will close on ${due}.`,
        finalNoteText: `The content will not be deleted, but your review window will close on ${input.due_date_display}.`,
      };
  }
}
