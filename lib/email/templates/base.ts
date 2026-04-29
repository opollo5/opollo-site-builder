import "server-only";

// ---------------------------------------------------------------------------
// AUTH-FOUNDATION P1 — Base email template.
//
// Single HTML + plaintext shell that every transactional message wraps
// itself in. Plain string interpolation — no @react-email, no
// templating engine — so the wrapper stays trivially testable and
// inspectable.
//
// HTML structure:
//   - Outer table (table-based layout because Outlook/Gmail/etc. mangle
//     div+flex layouts).
//   - 600px max width, single column, centred. The 600px cap is the
//     standard email-client viewport width below which nothing reflows.
//   - Inline CSS only — most clients strip <style> blocks.
//   - Header: Opollo wordmark (text fallback — no <img> assets shipped
//     in P1; brand image is a future polish concern that needs a CDN
//     link, alt text, and dark-mode handling).
//   - Body: caller-provided HTML, inserted between header + footer.
//   - Footer: small-print "Opollo, Melbourne AU" + transactional-email
//     legal note + the boilerplate "you received this because…" line
//     callers can override.
//
// Plaintext: parallel structure, line-wrapped at 72 chars where
// practical. Some clients show plaintext to screen readers and
// preview-only inboxes (Apple Mail glance), so the shape mirrors the
// HTML layout: header line, content, footer.
// ---------------------------------------------------------------------------

export interface BaseEmailInput {
  /** The action sentence at the top of the body. e.g. "Approve sign-in to Opollo Site Builder". */
  heading: string;
  /** Pre-formatted body HTML. Caller owns the inner markup; the wrapper is structural only. */
  bodyHtml: string;
  /** Plaintext mirror of `bodyHtml`. Required — every email ships both representations. */
  bodyText: string;
  /** Optional override for the "you received this because…" footer line. Defaults to the generic transactional-notice copy. */
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
    html: renderHtml(input.heading, input.bodyHtml, footerNote),
    text: renderText(input.heading, input.bodyText, footerNote),
  };
}

function renderHtml(heading: string, body: string, footerNote: string): string {
  // Inline CSS only. Indentation is conservative — Gmail strips
  // leading whitespace in some clients, so logical-block formatting.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f5f5f5;">
  <tr>
    <td align="center" style="padding:24px 16px;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;border:1px solid #e2e8f0;">
        <tr>
          <td style="padding:24px 32px 16px 32px;border-bottom:1px solid #e2e8f0;">
            <span style="font-size:18px;font-weight:600;letter-spacing:-0.01em;color:#0f172a;">Opollo</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h1 style="margin:0 0 16px 0;font-size:20px;line-height:1.3;font-weight:600;color:#0f172a;">${escapeHtml(heading)}</h1>
            ${body}
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

function renderText(heading: string, body: string, footerNote: string): string {
  // 72-char rule of thumb. Caller's `body` text is left as-is — they
  // know their content; we add only structural framing.
  return [
    "Opollo",
    "==========",
    "",
    heading,
    "",
    body,
    "",
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
