import "server-only";

import { renderBaseEmail, escapeHtml } from "./base";

// S1-6 — magic-link email to a reviewer asking them to approve a
// social post. Sent by POST /api/platform/social/posts/[id]/recipients
// after addRecipient() returns ok with the raw token.
//
// V1 keeps the body minimal — the snapshot lives behind the magic link
// rather than being inlined in the email, so reviewers always see the
// most up-to-date snapshot at the time of review (and can't be tricked
// by a stale email forward into approving a different draft).

export interface SocialApprovalRequestEmailInput {
  recipient_email: string;
  recipient_name: string | null;
  company_name: string;
  // Absolute URL to /approve/<raw_token>.
  review_url: string;
  // ISO timestamp string; rendered in the recipient's locale.
  expires_at: string;
}

export function renderSocialApprovalRequestEmail(
  input: SocialApprovalRequestEmailInput,
): { subject: string; html: string; text: string } {
  const subject = `Approval requested — ${input.company_name} on Opollo`;
  const greeting = input.recipient_name?.trim()
    ? escapeHtml(input.recipient_name.trim())
    : "Hi";
  const expiresLocal = formatExpiry(input.expires_at);

  const bodyHtml = `
    <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#0f172a;">
      ${greeting},
    </p>
    <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#0f172a;">
      <strong>${escapeHtml(input.company_name)}</strong> has prepared a
      social post and would like your approval before it's scheduled.
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:16px 0;">
      <tr>
        <td style="border-radius:6px;background-color:#0f172a;">
          <a href="${escapeHtml(input.review_url)}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">
            Review and respond
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 8px 0;font-size:12px;line-height:1.5;color:#64748b;">
      The link expires on <strong>${escapeHtml(expiresLocal)}</strong>.
    </p>
    <p style="margin:0;font-size:12px;line-height:1.5;color:#64748b;">
      If you didn't expect this request, you can safely ignore the
      email.
    </p>
  `;

  const textBody = [
    `${input.recipient_name?.trim() ?? "Hi"},`,
    ``,
    `${input.company_name} has prepared a social post and would like your approval.`,
    ``,
    `Review and respond: ${input.review_url}`,
    ``,
    `The link expires on ${expiresLocal}.`,
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

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}
