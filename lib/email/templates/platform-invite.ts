import "server-only";

import { renderBaseEmail, escapeHtml } from "./base";

// Platform-layer invitation email. Sent by POST /api/platform/invitations
// after sendInvitation() returns ok. Distinct from the operator-side
// invite.ts (which invites Opollo staff into opollo_users); this one
// invites a customer user into a customer company on the platform.

export interface PlatformInviteEmailInput {
  invitee_email: string;
  invited_by_email: string | null;
  company_name: string;
  // Customer-company role: admin / approver / editor / viewer.
  role: "admin" | "approver" | "editor" | "viewer";
  // Absolute URL to /invite/<raw_token>.
  accept_url: string;
  expires_at: string;
}

const ROLE_DESCRIPTION: Record<PlatformInviteEmailInput["role"], string> = {
  admin: "manage users, settings, and connections",
  approver: "approve content for publishing",
  editor: "draft and submit content for approval",
  viewer: "view the content calendar",
};

export function renderPlatformInviteEmail(
  input: PlatformInviteEmailInput,
): { subject: string; html: string; text: string } {
  const subject = `You're invited to ${input.company_name} on Opollo`;
  const expiresLocal = formatExpiry(input.expires_at);
  const inviter = input.invited_by_email ?? "An admin";
  const roleLabel = capitaliseRole(input.role);
  const roleNote = ROLE_DESCRIPTION[input.role];

  const bodyHtml = `
    <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#0f172a;">
      <strong>${escapeHtml(inviter)}</strong> invited you to join
      <strong>${escapeHtml(input.company_name)}</strong> on Opollo as
      <strong>${escapeHtml(roleLabel)}</strong> — you'll be able to ${escapeHtml(roleNote)}.
    </p>
    <p style="margin:0 0 16px 0;font-size:14px;line-height:1.5;color:#0f172a;">
      Click the button below to set your password and start using your
      account.
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:16px 0;">
      <tr>
        <td style="border-radius:6px;background-color:#0f172a;">
          <a href="${escapeHtml(input.accept_url)}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">
            Accept invitation
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 8px 0;font-size:12px;line-height:1.5;color:#64748b;">
      This invitation expires on <strong>${escapeHtml(expiresLocal)}</strong>.
      After that, ask ${escapeHtml(inviter)} for a new one.
    </p>
    <p style="margin:0;font-size:12px;line-height:1.5;color:#64748b;">
      If you weren't expecting this invitation, ignore this email — no
      account will be created until you set a password.
    </p>
  `;

  const bodyText = [
    `${inviter} invited you to join ${input.company_name} on Opollo as ${roleLabel} — you'll be able to ${roleNote}.`,
    "",
    "Click the link below to set your password and start using your account.",
    "",
    input.accept_url,
    "",
    `This invitation expires on ${expiresLocal}.`,
    `After that, ask ${inviter} for a new one.`,
    "",
    "If you weren't expecting this invitation, ignore this email — no account",
    "will be created until you set a password.",
  ].join("\n");

  const { html, text } = renderBaseEmail({
    heading: subject,
    bodyHtml,
    bodyText,
    footerNote:
      "You received this email because someone invited you to a company on Opollo.",
  });

  return { subject, html, text };
}

function capitaliseRole(role: PlatformInviteEmailInput["role"]): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function formatExpiry(iso: string): string {
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
