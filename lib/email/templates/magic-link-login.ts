import "server-only";

import { escapeHtml, renderBaseEmail } from "./base";

export interface MagicLinkLoginEmailInput {
  recipient_email: string;
  login_url: string;
  expires_at: string;
}

export function renderMagicLinkLoginEmail(
  input: MagicLinkLoginEmailInput,
): { subject: string; html: string; text: string } {
  const subject = "Your Opollo sign-in link";
  const expiresLocal = new Date(input.expires_at).toLocaleString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });

  const bodyHtml = `
    <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#0f172a;">
      Click the button below to sign in to Opollo. This link can only be
      used once and expires on <strong>${escapeHtml(expiresLocal)}</strong>.
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:16px 0;">
      <tr>
        <td style="border-radius:6px;background-color:#16a34a;">
          <a href="${escapeHtml(input.login_url)}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">
            Sign in to Opollo
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:12px;line-height:1.5;color:#64748b;">
      If you didn't request this link, you can safely ignore this email.
      Your account is not at risk.
    </p>
  `;

  const textBody = [
    `Sign in to Opollo`,
    ``,
    `Click the link below to sign in. This link expires on ${expiresLocal}.`,
    ``,
    input.login_url,
    ``,
    `If you didn't request this, ignore this email.`,
  ].join("\n");

  const { html, text } = renderBaseEmail({
    heading: subject,
    bodyHtml,
    bodyText: textBody,
    footerNote: "Sent automatically by Opollo.",
  });

  return { subject, html, text };
}
