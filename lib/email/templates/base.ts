import "server-only";

// ---------------------------------------------------------------------------
// Base email template — branded Opollo shell.
//
// Single HTML + plaintext shell. Every transactional email (invitations,
// approvals, connection-loss, feedback tickets, etc.) wraps its content
// in this shell. Content files are content-only — no chrome — so they
// physically cannot be off-brand.
//
// Design tokens (baked literal — CSS variables don't work in email):
//   Canvas:  #FAFAFA (outer bg)   White:   #ffffff (card bg)
//   Brand:   #00BF66 (CTA only)   Text:    #0f172a  Muted: #64748b
//   Border:  #e2e8f0
//
// Structure:
//   preheader → header (Opollo wordmark) → body slot → optional CTA → footer
//
// Rules (§13 of feedback spec / §9 of build spec):
//   - Table-based layout, fully inlined CSS (Outlook/Gmail compatible)
//   - System-font stack — web fonts don't load in email clients
//   - Plaintext alternative on every email
//   - Never import @sendgrid/mail here — only sendgrid.ts does that
// ---------------------------------------------------------------------------

export interface BaseEmailInput {
  /** Preheader text (shown in inbox preview). */
  preheader?: string;
  /** Heading rendered at the top of the body. */
  heading: string;
  /** Pre-formatted body HTML. Caller owns inner markup; wrapper is structural only. */
  bodyHtml: string;
  /** Plaintext mirror of bodyHtml. Required — every email ships both parts. */
  bodyText: string;
  /** Optional single primary CTA. Rendered as an emerald #00BF66 button. */
  cta?: { label: string; url: string };
  /** Override for the "you received this because…" footer line. */
  footerNote?: string;
}

const DEFAULT_FOOTER_NOTE =
  "You received this transactional email because of activity on your Opollo Site Builder account.";

const SUPPORT_NOTE = "Opollo · Melbourne AU";

export function renderBaseEmail(input: BaseEmailInput): {
  html: string;
  text: string;
} {
  const footerNote = input.footerNote ?? DEFAULT_FOOTER_NOTE;
  return {
    html: renderHtml(input.heading, input.bodyHtml, footerNote, input.cta, input.preheader),
    text: renderText(input.heading, input.bodyText, footerNote, input.cta),
  };
}

type Cta = { label: string; url: string };

function renderHtml(
  heading: string,
  body: string,
  footerNote: string,
  cta?: Cta,
  preheader?: string,
): string {
  const preheaderHtml = preheader
    ? `<div style="display:none;font-size:1px;color:#fafafa;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader)}</div>`
    : "";

  const ctaHtml = cta
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0;">
  <tr>
    <td style="border-radius:6px;background-color:#00BF66;">
      <a href="${escapeHtml(cta.url)}" target="_blank" style="display:inline-block;padding:12px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(cta.label)}</a>
    </td>
  </tr>
</table>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:#FAFAFA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
${preheaderHtml}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#FAFAFA;">
  <tr>
    <td align="center" style="padding:24px 16px;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;border:1px solid #e2e8f0;">
        <tr>
          <td style="padding:24px 32px 16px 32px;border-bottom:1px solid #e2e8f0;">
            <span style="font-size:18px;font-weight:700;letter-spacing:-0.02em;color:#0f172a;">Opollo</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h1 style="margin:0 0 16px 0;font-size:20px;line-height:1.3;font-weight:600;color:#0f172a;">${escapeHtml(heading)}</h1>
            ${body}
            ${ctaHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.5;color:#64748b;">
            <p style="margin:0 0 8px 0;">${escapeHtml(footerNote)}</p>
            <p style="margin:0;">${escapeHtml(SUPPORT_NOTE)}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function renderText(
  heading: string,
  body: string,
  footerNote: string,
  cta?: Cta,
): string {
  const ctaLine = cta ? [`${cta.label}: ${cta.url}`, ""] : [];
  return [
    "Opollo",
    "==========",
    "",
    heading,
    "",
    body,
    "",
    ...ctaLine,
    "----------",
    footerNote,
    SUPPORT_NOTE,
    "",
  ].join("\n");
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export { escapeHtml };
