#!/usr/bin/env -S npx tsx
/**
 * scripts/send-test-email.ts
 *
 * One-shot CLI to verify the SendGrid wrapper end-to-end without
 * going through the admin UI. The Phase 1 operator gate uses this:
 *
 *   SENDGRID_API_KEY=... \
 *   SENDGRID_FROM_EMAIL=noreply@opollo.com \
 *   SENDGRID_FROM_NAME="Opollo Site Builder" \
 *   SUPABASE_URL=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx tsx scripts/send-test-email.ts hi@opollo.com
 *
 *   # Or pass a custom subject + body:
 *   npx tsx scripts/send-test-email.ts hi@opollo.com "Hello" "Body text"
 *
 * Exits 0 on success (prints the X-Message-Id), exits 1 on failure
 * (prints the error code + message). The send is also written to
 * email_log either way — same as a production send.
 *
 * Reuses lib/email/sendgrid.ts so we exercise the exact same code
 * path the runtime uses. Tweaking the wrapper means re-running this
 * script confirms the change.
 */

import { sendEmail } from "@/lib/email/sendgrid";
import { renderBaseEmail } from "@/lib/email/templates/base";

async function main(): Promise<void> {
  const [, , to, subjectArg, bodyArg] = process.argv;

  if (!to) {
    console.error(
      "Usage: npx tsx scripts/send-test-email.ts <to-email> [subject] [body]",
    );
    process.exit(2);
  }

  const subject = subjectArg ?? "Opollo SendGrid wrapper smoke test";
  const message =
    bodyArg ??
    "If you're reading this, the SendGrid wrapper, base template, and email_log audit are working end-to-end.";

  const { html, text } = renderBaseEmail({
    heading: subject,
    bodyHtml: `<p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#0f172a;">${escape(message)}</p>`,
    bodyText: message,
    footerNote:
      "This is a P1 smoke-test email triggered from scripts/send-test-email.ts.",
  });

  const result = await sendEmail({ to, subject, html, text });

  if (result.ok) {
    console.error(`✓ Sent. SendGrid message id: ${result.messageId}`);
    console.log(JSON.stringify({ ok: true, messageId: result.messageId }, null, 2));
    process.exit(0);
  } else {
    console.error(`✗ Failed: ${result.error.code} — ${result.error.message}`);
    if (result.error.code === "SENDGRID_REJECTED" && result.error.statusCode) {
      console.error(`  HTTP ${result.error.statusCode} from SendGrid.`);
    }
    console.log(JSON.stringify({ ok: false, error: result.error }, null, 2));
    process.exit(1);
  }
}

function escape(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

main().catch((err) => {
  console.error(`Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
