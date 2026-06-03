import "server-only";

import { escapeHtml, renderBaseEmail } from "./base";

// ---------------------------------------------------------------------------
// portal-pre-expiry — B4 pre-expiry warning email template.
// Sent to portal_contact_email (or admin fallback) when a social connection
// is approaching expiry or has expired.
// ---------------------------------------------------------------------------

export type PreExpiryStage = "7d" | "1d" | "expired";

export interface PortalPreExpiryEmailInput {
  recipient_email: string;
  recipient_name: string | null;
  company_name: string;
  // The social connection details
  platform_display_name: string;
  platform_name: string;
  expires_at: string | null;
  stage: PreExpiryStage;
  // URL for the client to click to reconnect
  reconnect_url: string;
}

const STAGE_SUBJECT: Record<PreExpiryStage, string> = {
  "7d":      "Action needed: reconnect your {platform} account in 7 days",
  "1d":      "Urgent: reconnect your {platform} account tomorrow",
  "expired": "Reconnect required: your {platform} account has expired",
};

const STAGE_LEAD: Record<PreExpiryStage, string> = {
  "7d":
    "Your {company} social connection for {platform} will expire in approximately 7 days. " +
    "Reconnecting now keeps your scheduled posts publishing without interruption.",
  "1d":
    "Your {company} social connection for {platform} expires tomorrow. " +
    "Please reconnect today to avoid any disruption to your scheduled posts.",
  "expired":
    "Your {company} social connection for {platform} has expired and posts can no longer " +
    "be published to this account. Please reconnect as soon as possible.",
};

export function renderPortalPreExpiryEmail(
  input: PortalPreExpiryEmailInput,
): { subject: string; html: string; text: string } {
  const greeting = input.recipient_name?.trim()
    ? escapeHtml(input.recipient_name.trim())
    : "Hi";

  const fillTemplate = (s: string) =>
    s
      .replace("{platform}", escapeHtml(input.platform_display_name))
      .replace("{company}", escapeHtml(input.company_name));

  const subject = fillTemplate(STAGE_SUBJECT[input.stage]);
  const lead = fillTemplate(STAGE_LEAD[input.stage]);

  const expiryLine =
    input.expires_at && input.stage !== "expired"
      ? `<p style="margin:0 0 8px 0;font-size:13px;color:#64748b;">
           Expiry: <strong>${escapeHtml(
             new Date(input.expires_at).toLocaleString("en-AU", {
               day: "numeric", month: "long", year: "numeric",
               hour: "numeric", minute: "2-digit", timeZone: "UTC",
             }),
           )} UTC</strong>
         </p>`
      : "";

  const bodyHtml = `
    <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#0f172a;">
      ${greeting},
    </p>
    <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#0f172a;">
      ${escapeHtml(lead)}
    </p>
    ${expiryLine}
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:16px 0;">
      <tr>
        <td style="border-radius:6px;background-color:#16a34a;">
          <a href="${escapeHtml(input.reconnect_url)}"
             style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">
            Reconnect ${escapeHtml(input.platform_display_name)}
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:12px;line-height:1.5;color:#64748b;">
      This link is valid for a limited time. If you didn't expect this email,
      contact your account manager.
    </p>
  `;

  const textBody = [
    `${greeting},`,
    ``,
    fillTemplate(STAGE_LEAD[input.stage]),
    ``,
    ...(input.expires_at && input.stage !== "expired"
      ? [`Expiry: ${new Date(input.expires_at).toUTCString()}`, ``]
      : []),
    `Reconnect now: ${input.reconnect_url}`,
    ``,
    `If you didn't expect this email, contact your account manager.`,
  ].join("\n");

  const { html, text } = renderBaseEmail({
    heading: subject,
    bodyHtml,
    bodyText: textBody,
    footerNote: "Sent automatically by Opollo on behalf of " + input.company_name + ".",
  });

  return { subject, html, text };
}
