import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

// `@/lib/email/sendgrid` is loaded via dynamic import inside the function
// below — keeping it out of the static import graph here means the qstash
// handler's test bundle does not transitively pull in @sendgrid/mail, which
// is heavyweight and was the root cause of the precommit-hook timeout PR
// #1136 addressed.

// ---------------------------------------------------------------------------
// B3 — Operator email when a company's image-gen spend crosses 80% of its
// monthly budget for the first time.
//
// Recipients: all Opollo staff (mirrors the service-health notify pattern at
// lib/platform/service-health/notify.ts / recipients.ts — same query shape).
// Lives here (rather than service-health) because this is not a system-wide
// alert; it's a per-company budget signal, useful to the human operator
// running the image-gen pipeline so they can top up before the next batch
// hits the cap.
//
// Idempotency: the caller writes notified_80_at on the spend row before
// calling here, and only calls when crossed_80_percent === true. So this
// fires once per company per month.
// ---------------------------------------------------------------------------

export interface BudgetThresholdNotification {
  companyId: string;
  companyName?: string;
  spentCents: number;
  budgetCents: number;
}

export async function notifyImageGenBudgetThreshold(
  input: BudgetThresholdNotification,
): Promise<void> {
  try {
    const svc = getServiceRoleClient();
    const { data: staffRows, error } = await svc
      .from("platform_users")
      .select("email")
      .eq("is_opollo_staff", true)
      .is("deleted_at", null);

    if (error) {
      logger.warn("image.budget.notify_recipients_failed", { err: error.message });
      return;
    }

    const recipients = (staffRows ?? [])
      .map((r: { email: string }) => r.email)
      .filter(Boolean);

    if (recipients.length === 0) {
      logger.warn("image.budget.notify_no_recipients", { companyId: input.companyId });
      return;
    }

    const percent = Math.floor((input.spentCents / input.budgetCents) * 100);
    const subject = `[Opollo image-gen] ${input.companyName ?? input.companyId} crossed ${percent}% of monthly budget`;
    const dollarsSpent = (input.spentCents / 100).toFixed(2);
    const dollarsBudget = (input.budgetCents / 100).toFixed(2);

    const text = [
      `Image generation budget warning.`,
      ``,
      `Company: ${input.companyName ?? input.companyId} (${input.companyId})`,
      `Spent this month: $${dollarsSpent} of $${dollarsBudget} (${percent}%)`,
      ``,
      `The next batch dispatch will be rejected if it would push spend over `,
      `the cap. Increase monthly_image_gen_budget_cents on platform_companies `,
      `if more headroom is needed.`,
    ].join("\n");

    const html = `
<h2>Image generation budget warning</h2>
<p><strong>Company:</strong> ${escapeHtml(input.companyName ?? input.companyId)} (${escapeHtml(input.companyId)})</p>
<p><strong>Spent this month:</strong> $${dollarsSpent} of $${dollarsBudget} (${percent}%)</p>
<p>The next batch dispatch will be rejected if it would push spend over the cap.
Increase <code>monthly_image_gen_budget_cents</code> on <code>platform_companies</code> if more headroom is needed.</p>
`.trim();

    const { sendEmail } = await import("@/lib/email/sendgrid");
    for (const to of recipients) {
      try {
        await sendEmail({ to, subject, html, text });
      } catch (err) {
        logger.warn("image.budget.notify_email_failed", {
          to,
          companyId: input.companyId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info("image.budget.notify_sent", {
      companyId: input.companyId,
      recipients: recipients.length,
      percent,
    });
  } catch (err) {
    logger.warn("image.budget.notify_failed", {
      companyId: input.companyId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
