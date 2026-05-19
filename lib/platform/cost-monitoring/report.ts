import "server-only";

import { sendEmail } from "@/lib/email/sendgrid";
import { logger } from "@/lib/logger";
import { getPlatformAdminEmails } from "@/lib/platform/service-health/recipients";
import { buildCostReport, type CostReportData } from "./queries";

/**
 * Build and email the daily cost report to all Opollo staff.
 * Called by the cost-monitoring-daily-report cron (07:00 UTC).
 */
export async function sendDailyCostReport(): Promise<{ sent: number; recipients: string[] }> {
  const report = await buildCostReport(24);

  const recipients = await getPlatformAdminEmails();
  if (recipients.length === 0) {
    logger.info("cost_monitoring.report_no_recipients");
    return { sent: 0, recipients: [] };
  }

  const subject = buildSubject(report);
  const html = buildHtml(report);
  const text = buildText(report);

  let sent = 0;
  for (const to of recipients) {
    try {
      await sendEmail({ to, subject, html, text });
      sent++;
    } catch (err) {
      logger.warn("cost_monitoring.report_email_failed", {
        to,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("cost_monitoring.report_sent", {
    sent,
    totalCapCostUsd: report.cap.totalPeriodCostUsd,
    highUtilisationCount: report.cap.highUtilisationCount,
  });

  return { sent, recipients };
}

function buildSubject(r: CostReportData): string {
  const flags: string[] = [];
  if (r.cap.highUtilisationCount > 0) flags.push(`${r.cap.highUtilisationCount} CAP high-utilisation`);
  if (r.tenant.dailyBreachedCount > 0) flags.push(`${r.tenant.dailyBreachedCount} daily breach`);
  if (r.tenant.monthlyBreachedCount > 0) flags.push(`${r.tenant.monthlyBreachedCount} monthly breach`);

  if (flags.length === 0) {
    return `[COST] Daily report — $${r.cap.totalPeriodCostUsd.toFixed(4)} CAP spend, all clear`;
  }
  return `[COST] Daily report — ${flags.join(", ")}`;
}

function buildHtml(r: CostReportData): string {
  const capRows = r.cap.rows
    .map(
      (row) =>
        `<tr>
          <td style="padding:4px 8px">${esc(row.company_name)}</td>
          <td style="padding:4px 8px">${esc(row.tier)}</td>
          <td style="padding:4px 8px">$${row.period_cost_usd.toFixed(4)}</td>
          <td style="padding:4px 8px">${row.run_count}</td>
          <td style="padding:4px 8px;${row.cap_utilisation_pct >= 80 ? "color:#b91c1c;font-weight:bold" : ""}">${row.cap_utilisation_pct.toFixed(2)}%</td>
          <td style="padding:4px 8px">$${row.monthly_cap_usd.toFixed(2)}</td>
        </tr>`,
    )
    .join("");

  const tenantRows = r.tenant.rows
    .slice(0, 20)
    .map(
      (row) =>
        `<tr>
          <td style="padding:4px 8px">${esc(row.site_name ?? row.site_id)}</td>
          <td style="padding:4px 8px;${row.daily_utilisation_pct >= 100 ? "color:#b91c1c;font-weight:bold" : ""}">${row.daily_utilisation_pct.toFixed(1)}%</td>
          <td style="padding:4px 8px;${row.monthly_utilisation_pct >= 100 ? "color:#b91c1c;font-weight:bold" : ""}">${row.monthly_utilisation_pct.toFixed(1)}%</td>
        </tr>`,
    )
    .join("");

  return `
<h2 style="font-family:sans-serif">Daily Cost Report — ${new Date(r.generatedAt).toUTCString()}</h2>

<h3 style="font-family:sans-serif">CAP Generation Spend (last 24h)</h3>
<p style="font-family:sans-serif">
  Total: <strong>$${r.cap.totalPeriodCostUsd.toFixed(4)}</strong> across
  ${r.cap.subscriptionCount} subscription${r.cap.subscriptionCount !== 1 ? "s" : ""}
  ${r.cap.highUtilisationCount > 0 ? `— <span style="color:#b91c1c;font-weight:bold">${r.cap.highUtilisationCount} above 80% cap utilisation</span>` : ""}
</p>
${
  r.cap.rows.length > 0
    ? `<table style="border-collapse:collapse;font-family:sans-serif;font-size:13px">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="padding:4px 8px;text-align:left">Company</th>
            <th style="padding:4px 8px;text-align:left">Tier</th>
            <th style="padding:4px 8px;text-align:left">Period Cost</th>
            <th style="padding:4px 8px;text-align:left">Runs</th>
            <th style="padding:4px 8px;text-align:left">Cap Util.</th>
            <th style="padding:4px 8px;text-align:left">Monthly Cap</th>
          </tr>
        </thead>
        <tbody>${capRows}</tbody>
      </table>`
    : `<p style="font-family:sans-serif;color:#6b7280">No active CAP subscriptions.</p>`
}

<h3 style="font-family:sans-serif">Tenant Budget Utilisation (top 20)</h3>
${
  r.tenant.rows.length > 0
    ? `<table style="border-collapse:collapse;font-family:sans-serif;font-size:13px">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="padding:4px 8px;text-align:left">Site</th>
            <th style="padding:4px 8px;text-align:left">Daily Util.</th>
            <th style="padding:4px 8px;text-align:left">Monthly Util.</th>
          </tr>
        </thead>
        <tbody>${tenantRows}</tbody>
      </table>`
    : `<p style="font-family:sans-serif;color:#6b7280">No tenant budgets found.</p>`
}

<p style="font-family:sans-serif;font-size:11px;color:#9ca3af;margin-top:24px">
  Generated by Opollo cost-monitoring cron — ${r.generatedAt}
</p>
  `.trim();
}

function buildText(r: CostReportData): string {
  const lines: string[] = [
    `DAILY COST REPORT — ${new Date(r.generatedAt).toUTCString()}`,
    "",
    "CAP Generation Spend (last 24h)",
    `  Total: $${r.cap.totalPeriodCostUsd.toFixed(4)} across ${r.cap.subscriptionCount} subscription(s)`,
  ];

  if (r.cap.highUtilisationCount > 0) {
    lines.push(`  ⚠ ${r.cap.highUtilisationCount} subscription(s) above 80% monthly cap utilisation`);
  }

  for (const row of r.cap.rows) {
    lines.push(
      `  ${row.company_name} [${row.tier}] — $${row.period_cost_usd.toFixed(4)} (${row.cap_utilisation_pct.toFixed(2)}% of $${row.monthly_cap_usd.toFixed(2)} cap, ${row.run_count} runs)`,
    );
  }

  lines.push("", "Tenant Budget Utilisation (top 20)");

  if (r.tenant.dailyBreachedCount > 0) {
    lines.push(`  ⚠ ${r.tenant.dailyBreachedCount} site(s) at/above daily cap`);
  }
  if (r.tenant.monthlyBreachedCount > 0) {
    lines.push(`  ⚠ ${r.tenant.monthlyBreachedCount} site(s) at/above monthly cap`);
  }

  for (const row of r.tenant.rows.slice(0, 20)) {
    lines.push(
      `  ${row.site_name ?? row.site_id} — daily ${row.daily_utilisation_pct.toFixed(1)}% / monthly ${row.monthly_utilisation_pct.toFixed(1)}%`,
    );
  }

  lines.push("", `Generated: ${r.generatedAt}`);
  return lines.join("\n");
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
