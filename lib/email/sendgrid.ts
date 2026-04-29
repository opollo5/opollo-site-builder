import "server-only";

import sgMail from "@sendgrid/mail";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// AUTH-FOUNDATION P1 — SendGrid send wrapper.
//
// Single typed entrypoint for every transactional email Opollo sends.
// Phases 2-4 (invites, login challenges) consume this. Direct
// @sendgrid/mail calls outside this module are a code-review block.
//
// Behaviour:
//   - Lazy SendGrid auth (first call sets the key) so importing the
//     module doesn't crash builds when SENDGRID_API_KEY is unset
//     (preview deploys without prod secrets, etc.).
//   - One-retry on 5xx (network blip / SendGrid degradation), 250ms
//     backoff. 4xx is operator error (bad address, rejected sender) —
//     no retry, surface immediately.
//   - Every attempt is logged to email_log (success and failure) so
//     the operator can audit deliverability without reading server
//     logs. Logging failures DON'T fail the send — the email landed,
//     the audit is best-effort.
// ---------------------------------------------------------------------------

let authConfigured = false;

function configureSendGrid(): void {
  if (authConfigured) return;
  const key = process.env.SENDGRID_API_KEY;
  if (!key) {
    throw new Error(
      "SENDGRID_API_KEY is not set. Add it to Vercel env vars (and reload the dev server locally).",
    );
  }
  sgMail.setApiKey(key);
  authConfigured = true;
}

function fromAddress(): { email: string; name: string } {
  const email = process.env.SENDGRID_FROM_EMAIL;
  const name = process.env.SENDGRID_FROM_NAME ?? "Opollo Site Builder";
  if (!email) {
    throw new Error(
      "SENDGRID_FROM_EMAIL is not set. Expected `noreply@opollo.com` per the AUTH-FOUNDATION brief.",
    );
  }
  return { email, name };
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Optional Reply-To override. Defaults to the From address. */
  replyTo?: string;
}

export type SendEmailResult =
  | { ok: true; messageId: string }
  | {
      ok: false;
      error: {
        code:
          | "SENDGRID_REJECTED"
          | "SENDGRID_5XX"
          | "SENDGRID_NETWORK"
          | "SENDGRID_UNCONFIGURED"
          | "SENDGRID_UNKNOWN";
        message: string;
        statusCode?: number;
      };
    };

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  let result: SendEmailResult;
  try {
    configureSendGrid();
  } catch (err) {
    result = {
      ok: false,
      error: {
        code: "SENDGRID_UNCONFIGURED",
        message: err instanceof Error ? err.message : String(err),
      },
    };
    await writeEmailLog(input, result);
    return result;
  }

  const from = fromAddress();
  const message = {
    to: input.to,
    from: { email: from.email, name: from.name },
    replyTo: input.replyTo,
    subject: input.subject,
    html: input.html,
    text: input.text,
  };

  // First attempt + one retry on 5xx. 4xx surfaces immediately.
  result = await attemptSend(message);
  if (!result.ok && result.error.code === "SENDGRID_5XX") {
    logger.warn("sendgrid 5xx — retrying once after 250ms", {
      to: input.to,
      subject: input.subject,
      status: result.error.statusCode,
    });
    await new Promise((r) => setTimeout(r, 250));
    result = await attemptSend(message);
  }

  await writeEmailLog(input, result);
  return result;
}

async function attemptSend(
  message: Parameters<typeof sgMail.send>[0],
): Promise<SendEmailResult> {
  try {
    const [response] = await sgMail.send(message);
    const messageId =
      (response.headers["x-message-id"] as string | undefined) ?? "unknown";
    return { ok: true, messageId };
  } catch (err) {
    const errAny = err as {
      code?: number;
      response?: { body?: { errors?: Array<{ message?: string }> } };
      message?: string;
    };
    const status = errAny.code;
    const apiMessage =
      errAny.response?.body?.errors?.[0]?.message ?? errAny.message ?? "unknown";

    if (typeof status === "number") {
      if (status >= 500) {
        return {
          ok: false,
          error: {
            code: "SENDGRID_5XX",
            message: apiMessage,
            statusCode: status,
          },
        };
      }
      return {
        ok: false,
        error: {
          code: "SENDGRID_REJECTED",
          message: apiMessage,
          statusCode: status,
        },
      };
    }

    return {
      ok: false,
      error: {
        code: "SENDGRID_NETWORK",
        message: apiMessage,
      },
    };
  }
}

async function writeEmailLog(
  input: SendEmailInput,
  result: SendEmailResult,
): Promise<void> {
  try {
    const supabase = getServiceRoleClient();
    const row = {
      to_email: input.to,
      subject: input.subject,
      status: result.ok ? "sent" : "failed",
      sendgrid_message_id: result.ok ? result.messageId : null,
      error_code: result.ok ? null : result.error.code,
      error_message: result.ok ? null : result.error.message,
    };
    const { error } = await supabase.from("email_log").insert(row);
    if (error) {
      logger.error("email_log insert failed", {
        supabase_error: error.message,
        to: input.to,
      });
    }
  } catch (err) {
    // Never let an audit-write failure break the send-result return.
    logger.error("email_log unhandled write error", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
