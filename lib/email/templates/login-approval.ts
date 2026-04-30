import "server-only";

import { renderBaseEmail, escapeHtml } from "./base";

// AUTH-FOUNDATION P4.2 — Login approval email.
//
// Sent by the login server action when a password-valid sign-in
// arrives from an untrusted device. Wraps the brand-base shell with:
//   - "Approve sign-in to Opollo Site Builder"
//   - Device line: "Device: <browser> on <OS>, <timestamp>"
//   - Big "Approve sign-in" button → /auth/approve?token=<raw>
//   - 15-minute expiry note
//   - Footer warning to ignore + change password if not from operator

export interface LoginApprovalEmailInput {
  /** Recipient email (the user trying to sign in). */
  to_email: string;
  /** Absolute URL to /auth/approve?token=<raw_token>. */
  approve_url: string;
  /** ISO timestamp when the challenge expires (15 min after creation). */
  expires_at: string;
  /** Raw User-Agent header from the originating request. Optional. */
  ua_string: string | null;
  /** Approximate IP-derived locator. Phase 4 ships without geo, so
   *  this is just a "we saw a request" anchor; pass null until a
   *  geo-IP feed lands. */
  approx_location?: string | null;
}

interface ParsedAgent {
  browser: string;
  os: string;
}

// Tiny UA parser. Not exhaustive — catches the common browsers + OSes
// well enough for the email-body display. Operator opens an email and
// scans "Chrome on Mac" / "Safari on iOS"; missing edge cases just
// surface as "browser on os" placeholders.
function parseUa(ua: string | null): ParsedAgent {
  if (!ua) return { browser: "an unknown browser", os: "an unknown device" };

  let browser = "an unknown browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\//.test(ua)) browser = "Opera";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua)) browser = "Safari";

  let os = "an unknown device";
  if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Mac OS X/.test(ua)) os = "Mac";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Linux/.test(ua)) os = "Linux";

  return { browser, os };
}

function formatTimestamp(iso: string): string {
  // UTC, unambiguous for a globally-distributed inbox.
  const d = new Date(iso);
  return `${d.toLocaleString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })}, ${d.toLocaleString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false,
  })} UTC`;
}

export function renderLoginApprovalEmail(input: LoginApprovalEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = "Approve sign-in to Opollo Site Builder";
  const agent = parseUa(input.ua_string);
  const requestedAt = formatTimestamp(new Date().toISOString());
  const expiresAt = formatTimestamp(input.expires_at);

  const deviceLine = `${agent.browser} on ${agent.os}, ${requestedAt}`;

  const bodyHtml = `
    <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#0f172a;">
      We received a sign-in attempt for your account.
    </p>
    <p style="margin:0 0 16px 0;font-size:13px;line-height:1.5;color:#334155;">
      <strong>Device:</strong> ${escapeHtml(deviceLine)}
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:16px 0;">
      <tr>
        <td style="border-radius:6px;background-color:#0f172a;">
          <a href="${escapeHtml(input.approve_url)}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">
            Approve sign-in
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 8px 0;font-size:12px;line-height:1.5;color:#64748b;">
      This link expires at <strong>${escapeHtml(expiresAt)}</strong>.
    </p>
    <p style="margin:0;font-size:12px;line-height:1.5;color:#64748b;">
      If you didn&apos;t try to sign in, ignore this email and change
      your password immediately at /auth/forgot-password.
    </p>
  `;

  const bodyText = [
    "We received a sign-in attempt for your account.",
    "",
    `Device: ${deviceLine}`,
    "",
    "Approve sign-in by clicking the link below:",
    input.approve_url,
    "",
    `This link expires at ${expiresAt}.`,
    "",
    "If you didn't try to sign in, ignore this email and change your",
    "password immediately at /auth/forgot-password.",
  ].join("\n");

  const { html, text } = renderBaseEmail({
    heading: subject,
    bodyHtml,
    bodyText,
    footerNote:
      "You received this email because someone signed in to your Opollo account.",
  });

  return { subject, html, text };
}
