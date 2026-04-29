import "server-only";

import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Email transport abstraction.
//
// The Site Builder doesn't yet ship a transactional email provider —
// the brief flagged this as TBD ("likely SendGrid or Postmark — confirm
// during Phase 1 Week 1"). This module provides the seam: when
// OPTIMISER_EMAIL_PROVIDER is unset, sends are no-ops that log the
// payload (so staff can see what would have shipped). When the
// provider is wired up, swap in the implementation behind the same
// `sendEmail` signature; no caller changes.
//
// Per CLAUDE.md observability contract: "anything that reaches an
// external service must degrade gracefully when its secret is unset".
// ---------------------------------------------------------------------------

export type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** opaque tag for grouping in the provider dashboard. */
  category?: string;
};

export type SendResult = {
  ok: boolean;
  provider: "noop" | "log_only" | "sendgrid" | "postmark" | "resend";
  message_id?: string;
  error?: string;
};

export async function sendEmail(payload: EmailPayload): Promise<SendResult> {
  const provider = process.env.OPTIMISER_EMAIL_PROVIDER;

  if (!provider || provider === "noop") {
    logger.info("optimiser.email.skipped_no_provider", {
      to_domain: payload.to.split("@")[1] ?? "(invalid)",
      subject: payload.subject,
      category: payload.category,
      bytes: payload.html.length,
    });
    return { ok: true, provider: "noop" };
  }

  if (provider === "log_only") {
    logger.info("optimiser.email.log_only", {
      to: payload.to,
      subject: payload.subject,
      category: payload.category,
      bytes: payload.html.length,
    });
    return { ok: true, provider: "log_only" };
  }

  // Real-provider implementations land in a follow-up slice once a
  // SendGrid / Postmark API key is provisioned. The shape below is
  // suggestive, not running.
  logger.warn("optimiser.email.unsupported_provider", {
    provider,
    to: payload.to,
  });
  return {
    ok: false,
    provider: "noop",
    error: `Unsupported email provider: ${provider}`,
  };
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
