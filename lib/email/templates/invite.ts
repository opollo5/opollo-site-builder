import "server-only";

import { renderBaseEmail, escapeHtml } from "./base";

// AUTH-FOUNDATION P3.2 — Invite email template.
//
// Sent by POST /api/admin/invites after a successful createInvite().
// Wraps the brand-base shell with the invite-specific copy:
//   - "You've been invited to Opollo Site Builder"
//   - Who invited them (actor's email)
//   - What role they'll have
//   - Big "Accept invite" button → /auth/accept-invite?token=<raw>
//   - 24-hour expiry note
//   - Footer warning to ignore if they didn't expect this

export interface InviteEmailInput {
  /** Recipient (the invitee). Used only in the email body, not in headers. */
  invitee_email: string;
  /** Email of the actor who created the invite. */
  invited_by_email: string;
  /** Role the invitee will receive on acceptance. */
  role: "admin" | "user";
  /** Absolute URL to /auth/accept-invite?token=<raw_token>. */
  accept_url: string;
  /** ISO timestamp of when the invite expires (24h after creation). */
  expires_at: string;
}

export function renderInviteEmail(input: InviteEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = "You've been invited to Opollo Site Builder";

  const expiresLocal = formatExpiry(input.expires_at);

  const bodyHtml = `
    <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#0f172a;">
      <strong>${escapeHtml(input.invited_by_email)}</strong> invited you to
      Opollo Site Builder as <strong>${escapeHtml(input.role)}</strong>.
    </p>
    <p style="margin:0 0 16px 0;font-size:14px;line-height:1.5;color:#0f172a;">
      Opollo is a builder for managing WordPress sites with AI assistance.
      Click the button below to set your password and complete sign-up.
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:16px 0;">
      <tr>
        <td style="border-radius:6px;background-color:#0f172a;">
          <a href="${escapeHtml(input.accept_url)}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">
            Accept invite
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 8px 0;font-size:12px;line-height:1.5;color:#64748b;">
      This invite expires on <strong>${escapeHtml(expiresLocal)}</strong>.
      After that, ask ${escapeHtml(input.invited_by_email)} for a new one.
    </p>
    <p style="margin:0;font-size:12px;line-height:1.5;color:#64748b;">
      If you weren't expecting this invite, ignore this email — no account
      will be created until you set a password.
    </p>
  `;

  const bodyText = [
    `${input.invited_by_email} invited you to Opollo Site Builder as ${input.role}.`,
    "",
    "Opollo is a builder for managing WordPress sites with AI assistance.",
    "Click the link below to set your password and complete sign-up.",
    "",
    input.accept_url,
    "",
    `This invite expires on ${expiresLocal}.`,
    `After that, ask ${input.invited_by_email} for a new one.`,
    "",
    "If you weren't expecting this invite, ignore this email — no account",
    "will be created until you set a password.",
  ].join("\n");

  const { html, text } = renderBaseEmail({
    heading: subject,
    bodyHtml,
    bodyText,
    footerNote:
      "You received this email because someone invited you to an Opollo Site Builder account.",
  });

  return { subject, html, text };
}

function formatExpiry(iso: string): string {
  // Format as "Wed 1 May 2026, 17:30 UTC" — readable, unambiguous,
  // no timezone-magic. Email clients across timezones see the same
  // string.
  const d = new Date(iso);
  const day = d.toLocaleString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const time = d.toLocaleString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false,
  });
  return `${day}, ${time} UTC`;
}
