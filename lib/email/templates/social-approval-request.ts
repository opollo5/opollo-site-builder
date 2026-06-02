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
//
// Phase-2 additions: optional versionLabel, dueDateDisplay, reviewerRole
// fields surfaced when provided (workflow approval engine).

export interface SocialApprovalRequestEmailInput {
  recipient_email: string;
  recipient_name: string | null;
  company_name: string;
  // Absolute URL to /approve/<raw_token>.
  review_url: string;
  // ISO timestamp string; rendered in the recipient's locale.
  expires_at: string;
  // Optional Phase-2 fields from the approval workflow engine.
  // "Version 2" — derived from review_round + 1 at creation time.
  versionLabel?: string;
  // Formatted due date in company timezone, e.g. "14 Jun 2026".
  dueDateDisplay?: string;
  // "Approver" or "External reviewer".
  reviewerRole?: string;
}

export function renderSocialApprovalRequestEmail(
  input: SocialApprovalRequestEmailInput,
): { subject: string; html: string; text: string } {
  const subject = `Approval requested — ${input.company_name} on Opollo`;
  const greeting = input.recipient_name?.trim()
    ? escapeHtml(input.recipient_name.trim())
    : "Hi";
  const expiresLocal = formatExpiry(input.expires_at);

  const metaRows = [
    input.versionLabel
      ? `<p style="margin:0 0 6px 0;font-size:13px;color:#64748b;"><strong>Version:</strong> ${escapeHtml(input.versionLabel)}</p>`
      : "",
    input.reviewerRole
      ? `<p style="margin:0 0 6px 0;font-size:13px;color:#64748b;"><strong>Your role:</strong> ${escapeHtml(input.reviewerRole)}</p>`
      : "",
    input.dueDateDisplay
      ? `<p style="margin:0 0 6px 0;font-size:13px;color:#64748b;"><strong>Due by:</strong> ${escapeHtml(input.dueDateDisplay)}</p>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const bodyHtml = `
    <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#0f172a;">
      ${greeting},
    </p>
    <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#0f172a;">
      <strong>${escapeHtml(input.company_name)}</strong> has prepared a
      social post and would like your approval before it's scheduled.
    </p>
    ${metaRows}
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:16px 0;">
      <tr>
        <td style="border-radius:6px;background-color:#16a34a;">
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

  const textMetaLines: string[] = [];
  if (input.versionLabel) textMetaLines.push(`Version: ${input.versionLabel}`);
  if (input.reviewerRole) textMetaLines.push(`Your role: ${input.reviewerRole}`);
  if (input.dueDateDisplay) textMetaLines.push(`Due by: ${input.dueDateDisplay}`);

  const textBody = [
    `${input.recipient_name?.trim() ?? "Hi"},`,
    ``,
    `${input.company_name} has prepared a social post and would like your approval.`,
    ...(textMetaLines.length > 0 ? ["", ...textMetaLines] : []),
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
