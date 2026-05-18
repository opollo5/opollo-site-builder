import "server-only";

import { sendEmail } from "@/lib/email/sendgrid";
import { logger } from "@/lib/logger";
import { getPlatformAdminEmails } from "./recipients";
import type { ServiceHealthEvent } from "./types";

// Minimum interval between notifications for the same event.
const NOTIFY_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Send a critical service health alert to all platform admins.
 *
 * Self-monitoring exclusion:
 * - When serviceName === 'sendgrid', skip email (can't email about SendGrid
 *   via SendGrid). Log only + Slack fallback.
 * - When serviceName === 'upstash-redis', skip Redis-based rate checks.
 *
 * Notification cooldown: 30-minute window enforced by the caller
 * (health-check cron queries notified_at < NOW() - INTERVAL '30 min').
 */
export async function notifyHealthAlert(event: ServiceHealthEvent): Promise<void> {
  const isSendGridFailing = event.service_name === "sendgrid";

  logger.info("service_health.notify_attempt", {
    eventId: event.id,
    service: event.service_name,
    eventType: event.event_type,
    severity: event.severity,
    skippingEmail: isSendGridFailing,
  });

  if (!isSendGridFailing) {
    const recipients = await getPlatformAdminEmails();
    if (recipients.length === 0) {
      logger.warn("service_health.notify_no_recipients", { eventId: event.id });
    }

    for (const to of recipients) {
      try {
        await sendEmail({
          to,
          subject: `[ALERT] ${event.service_name} — ${event.event_type} (${event.severity})`,
          html: buildAlertHtml(event),
          text: buildAlertText(event),
        });
      } catch (err) {
        // Don't fail the loop for one bad recipient.
        logger.warn("service_health.notify_email_failed", {
          to,
          eventId: event.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Slack fallback — used when email fails or for SendGrid self-monitoring.
  const slackUrl = process.env.SLACK_WEBHOOK_URL_OPS;
  if (slackUrl) {
    void notifySlack(slackUrl, event).catch((err) =>
      logger.warn("service_health.slack_failed", {
        err: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

async function notifySlack(webhookUrl: string, event: ServiceHealthEvent): Promise<void> {
  const resp = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `🚨 *${event.service_name}* — ${event.event_type} (${event.severity})\n${
        event.operation ? `Operation: ${event.operation}\n` : ""
      }Occurrences: ${event.occurrence_count}\nFirst seen: ${event.first_seen_at}`,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Slack webhook returned ${resp.status}`);
  }
}

function buildAlertHtml(event: ServiceHealthEvent): string {
  return `
<h2>Service Health Alert</h2>
<p><strong>Service:</strong> ${event.service_name}</p>
<p><strong>Event type:</strong> ${event.event_type}</p>
<p><strong>Severity:</strong> ${event.severity}</p>
${event.operation ? `<p><strong>Operation:</strong> ${event.operation}</p>` : ""}
<p><strong>Occurrences:</strong> ${event.occurrence_count}</p>
<p><strong>First seen:</strong> ${event.first_seen_at}</p>
<p><strong>Last seen:</strong> ${event.last_seen_at}</p>
${Object.keys(event.details).length > 0 ? `<pre>${JSON.stringify(event.details, null, 2)}</pre>` : ""}
`.trim();
}

function buildAlertText(event: ServiceHealthEvent): string {
  return [
    `Service Health Alert`,
    `Service: ${event.service_name}`,
    `Event type: ${event.event_type}`,
    `Severity: ${event.severity}`,
    event.operation ? `Operation: ${event.operation}` : null,
    `Occurrences: ${event.occurrence_count}`,
    `First seen: ${event.first_seen_at}`,
    `Last seen: ${event.last_seen_at}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** @internal — for notification rate-limit check in tests */
export { NOTIFY_COOLDOWN_MS };
