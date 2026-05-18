import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { sendEmail } from "@/lib/email/sendgrid";
import { logger } from "@/lib/logger";
import { getPlatformAdminEmails } from "./recipients";
import type { ServiceHealthEvent } from "./types";

/**
 * Generate and send the daily service health digest email.
 * Summarises all events from the past 24 hours grouped by service.
 * Called by the health-digest cron (0 23 * * * UTC).
 */
export async function sendDailyDigest(): Promise<{ sent: number; recipients: string[] }> {
  const svc = getServiceRoleClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: events, error } = await svc
    .from("service_health_events")
    .select("*")
    .gte("last_seen_at", since)
    .order("severity", { ascending: false })
    .order("last_seen_at", { ascending: false })
    .limit(100);

  if (error) {
    logger.warn("service_health.digest_query_failed", { err: error.message });
    return { sent: 0, recipients: [] };
  }

  const rows = (events ?? []) as ServiceHealthEvent[];

  const recipients = await getPlatformAdminEmails();
  if (recipients.length === 0) {
    logger.info("service_health.digest_no_recipients");
    return { sent: 0, recipients: [] };
  }

  const html = buildDigestHtml(rows);
  const text = buildDigestText(rows);
  const subject =
    rows.length === 0
      ? "[DIGEST] Service health — all clear"
      : `[DIGEST] Service health — ${rows.length} event(s) in last 24h`;

  let sent = 0;
  for (const to of recipients) {
    try {
      await sendEmail({ to, subject, html, text });
      sent++;
    } catch (err) {
      logger.warn("service_health.digest_email_failed", {
        to,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("service_health.digest_sent", { sent, total: rows.length });
  return { sent, recipients };
}

function buildDigestHtml(events: ServiceHealthEvent[]): string {
  if (events.length === 0) {
    return "<h2>Daily Service Health Digest</h2><p>All services healthy in the last 24 hours. ✅</p>";
  }

  const byService: Record<string, ServiceHealthEvent[]> = {};
  for (const e of events) {
    (byService[e.service_name] ??= []).push(e);
  }

  const rows = Object.entries(byService)
    .map(([service, evts]) => {
      const lines = evts
        .map(
          (e) =>
            `<tr><td>${e.event_type}</td><td>${e.severity}</td><td>${e.occurrence_count}</td><td>${e.last_seen_at}</td><td>${e.resolved_at ? "✅" : "🔴"}</td></tr>`,
        )
        .join("");
      return `<h3>${service}</h3><table border="1" cellpadding="4"><tr><th>Type</th><th>Severity</th><th>Count</th><th>Last seen</th><th>Resolved</th></tr>${lines}</table>`;
    })
    .join("");

  return `<h2>Daily Service Health Digest</h2>${rows}`;
}

function buildDigestText(events: ServiceHealthEvent[]): string {
  if (events.length === 0) return "Daily Service Health Digest\n\nAll services healthy.";
  return (
    "Daily Service Health Digest\n\n" +
    events
      .map(
        (e) =>
          `${e.service_name} — ${e.event_type} (${e.severity}) × ${e.occurrence_count} [${e.resolved_at ? "resolved" : "open"}]`,
      )
      .join("\n")
  );
}
