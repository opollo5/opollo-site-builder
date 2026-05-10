import "server-only";

import { escapeHtml, renderBaseEmail } from "./base";
import type { ErrorReport } from "@/lib/error-reporting/types";

// ---------------------------------------------------------------------------
// Error-report email template — follows the Phase 5 contract exactly.
//
// Both plain-text and HTML renderings include all non-empty sections.
// Sections that don't apply to a given report are omitted entirely
// (not left empty).
// ---------------------------------------------------------------------------

interface EnrichedContext {
  userEmail?: string;
  userName?: string;
  userRole?: string;
  orgId?: string;
  logLines?: string;
  dbErrors?: string;
}

export function renderErrorReportEmail(
  report: ErrorReport,
  enriched: EnrichedContext = {},
): { subject: string; html: string; text: string } {
  const firstLine = report.errorMessage.slice(0, 80);
  const errorType = report.errorType ?? "Error";
  const recipientEmail = enriched.userEmail ?? report.userEmail ?? "unknown";
  const subject = `[Opollo UAT] ${errorType}: ${firstLine} — ${recipientEmail}`;

  const text = buildText(report, enriched);
  const html = buildHtml(report, enriched);
  const { html: wrappedHtml, text: wrappedText } = renderBaseEmail({
    heading: "Opollo Error Report",
    bodyHtml: html,
    bodyText: text,
    footerNote: "This report was submitted by a user via the in-app error reporting button.",
  });

  return { subject, html: wrappedHtml, text: wrappedText };
}

// ---- Plain-text builder --------------------------------------------------

function buildText(report: ErrorReport, enriched: EnrichedContext): string {
  const lines: string[] = [];
  const push = (...args: string[]) => lines.push(...args);

  push("# Opollo Error Report", "");
  push(`Reported: ${report.timestamp}`);
  push(
    `Reporter: ${enriched.userName ?? "(unknown)"} <${enriched.userEmail ?? report.userEmail ?? "unknown"}> (role: ${enriched.userRole ?? report.userRole ?? "unknown"}, org: ${enriched.orgId ?? "unknown"})`,
  );
  push(
    `Environment: ${report.environment ?? "unknown"} | Build: ${report.gitSha ?? "unknown"} | Session: (see request logs)`,
  );
  push("");

  if (report.userDescription) {
    push("## What the user was trying to do", report.userDescription, "");
  }

  push("## Error");
  push(`Type: ${report.errorType ?? "Error"}`);
  push(`Message: ${report.errorMessage}`, "");

  if (report.stack) {
    push("### Stack trace", "```", report.stack, "```", "");
  }
  if (report.componentStack) {
    push("### Component stack", "```", report.componentStack, "```", "");
  }

  push("## Where this happened");
  push(`Current URL: ${report.currentUrl}`);
  if (report.previousUrl) push(`Previous URL: ${report.previousUrl}`);
  push("");

  if (report.apiCall) {
    const a = report.apiCall;
    push("## API call");
    push(`${a.method} ${a.url} → ${a.status}${a.durationMs !== undefined ? ` (${a.durationMs} ms)` : ""}`);
    if (a.requestId) push(`Request id: ${a.requestId}`);
    if (a.responseBody) push("Response body:", "```", a.responseBody, "```");
    push("");
  }

  if (report.breadcrumbs.length > 0) {
    push("## Recent user actions (last 5 min)");
    report.breadcrumbs.slice(0, 20).forEach((b, i) => {
      push(`${i + 1}. [${b.ts}] ${b.type}: ${JSON.stringify(b.data)}`);
    });
    push("");
  }

  if (report.routeHistory.length > 0) {
    push("## Recent route changes");
    report.routeHistory.forEach((r, i) => {
      push(`${i + 1}. [${r.ts}] ${r.from || "(start)"} → ${r.to}`);
    });
    push("");
  }

  if (report.stateSlice) {
    push("## Application state (relevant slice)");
    push("```json", JSON.stringify(report.stateSlice, null, 2), "```", "");
  }

  if (enriched.logLines || enriched.dbErrors) {
    push("## Server-side context");
    if (enriched.logLines) push("Recent log lines:", "```", enriched.logLines, "```");
    if (enriched.dbErrors) push("Recent DB errors:", "```", enriched.dbErrors, "```");
    push("");
  }

  push("## Environment");
  push(`Browser: ${report.browser}`);
  push(`Viewport: ${report.viewport}`);
  push(`Locale: ${report.locale} | TZ: ${report.timezone}`);
  push("");

  push("## Brief for the next engineer / AI");
  push("Start with:");
  if (report.stack) {
    const topFrame = report.stack.split("\n")[1]?.trim() ?? "";
    push(`1. Top stack frame: ${topFrame}`);
  }
  if (report.apiCall) {
    push(`2. Handler for ${report.apiCall.method} ${report.apiCall.url}`);
    if (report.apiCall.requestId) {
      push(`3. Server logs for request id ${report.apiCall.requestId} around ${report.timestamp}`);
    }
  }
  push(`Build: ${report.gitSha ?? "unknown"} (look up in Sentry for source-mapped frames)`);

  return lines.join("\n");
}

// ---- HTML builder --------------------------------------------------------

function section(title: string, content: string): string {
  return `<h2 style="margin:24px 0 8px 0;font-size:15px;font-weight:600;color:#0f172a;border-top:1px solid #e2e8f0;padding-top:16px;">${escapeHtml(title)}</h2>${content}`;
}

function code(content: string): string {
  return `<pre style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:12px;font-size:11px;line-height:1.5;color:#1e293b;overflow-x:auto;white-space:pre-wrap;word-break:break-all;max-height:300px;">${escapeHtml(content)}</pre>`;
}

function kv(key: string, value: string): string {
  return `<p style="margin:4px 0;font-size:13px;"><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value)}</p>`;
}

function buildHtml(report: ErrorReport, enriched: EnrichedContext): string {
  const parts: string[] = [];

  parts.push(
    `<p style="margin:0 0 4px 0;font-size:13px;"><strong>Reported:</strong> ${escapeHtml(report.timestamp)}</p>`,
    `<p style="margin:0 0 4px 0;font-size:13px;"><strong>Reporter:</strong> ${escapeHtml(enriched.userName ?? "(unknown)")} &lt;${escapeHtml(enriched.userEmail ?? report.userEmail ?? "unknown")}&gt; (role: ${escapeHtml(enriched.userRole ?? report.userRole ?? "unknown")}, org: ${escapeHtml(enriched.orgId ?? "unknown")})</p>`,
    `<p style="margin:0 0 16px 0;font-size:13px;"><strong>Environment:</strong> ${escapeHtml(report.environment ?? "unknown")} | Build: ${escapeHtml(report.gitSha ?? "unknown")}</p>`,
  );

  if (report.userDescription) {
    parts.push(
      section(
        "What the user was trying to do",
        `<p style="font-size:13px;margin:0;">${escapeHtml(report.userDescription)}</p>`,
      ),
    );
  }

  parts.push(
    section(
      "Error",
      kv("Type", report.errorType ?? "Error") +
        kv("Message", report.errorMessage) +
        (report.stack ? `<p style="margin:8px 0 4px;font-size:12px;font-weight:600;">Stack trace</p>${code(report.stack)}` : "") +
        (report.componentStack ? `<p style="margin:8px 0 4px;font-size:12px;font-weight:600;">Component stack</p>${code(report.componentStack)}` : ""),
    ),
  );

  parts.push(
    section(
      "Where this happened",
      kv("Current URL", report.currentUrl) +
        (report.previousUrl ? kv("Previous URL", report.previousUrl) : ""),
    ),
  );

  if (report.apiCall) {
    const a = report.apiCall;
    parts.push(
      section(
        "API call",
        kv(
          `${a.method} ${a.url}`,
          `→ ${a.status}${a.durationMs !== undefined ? ` (${a.durationMs} ms)` : ""}`,
        ) +
          (a.requestId ? kv("Request id", a.requestId) : "") +
          (a.responseBody ? `<p style="margin:8px 0 4px;font-size:12px;font-weight:600;">Response body</p>${code(a.responseBody)}` : ""),
      ),
    );
  }

  if (report.breadcrumbs.length > 0) {
    const rows = report.breadcrumbs
      .slice(0, 20)
      .map(
        (b, i) =>
          `<tr><td style="padding:3px 8px;font-size:11px;color:#64748b;white-space:nowrap;">${i + 1}.</td><td style="padding:3px 8px;font-size:11px;color:#64748b;white-space:nowrap;">${escapeHtml(b.ts)}</td><td style="padding:3px 8px;font-size:11px;">${escapeHtml(b.type)}</td><td style="padding:3px 8px;font-size:11px;word-break:break-all;">${escapeHtml(JSON.stringify(b.data))}</td></tr>`,
      )
      .join("");
    parts.push(
      section(
        "Recent user actions (last 5 min)",
        `<table style="border-collapse:collapse;width:100%;font-size:12px;">${rows}</table>`,
      ),
    );
  }

  if (report.routeHistory.length > 0) {
    const rows = report.routeHistory
      .map(
        (r, i) =>
          `<tr><td style="padding:3px 8px;font-size:11px;color:#64748b;">${i + 1}.</td><td style="padding:3px 8px;font-size:11px;color:#64748b;white-space:nowrap;">${escapeHtml(r.ts)}</td><td style="padding:3px 8px;font-size:11px;word-break:break-all;">${escapeHtml(r.from || "(start)")} → ${escapeHtml(r.to)}</td></tr>`,
      )
      .join("");
    parts.push(
      section(
        "Recent route changes",
        `<table style="border-collapse:collapse;width:100%;">${rows}</table>`,
      ),
    );
  }

  if (report.stateSlice) {
    parts.push(
      section("Application state (relevant slice)", code(JSON.stringify(report.stateSlice, null, 2))),
    );
  }

  if (enriched.logLines || enriched.dbErrors) {
    const serverContent =
      (enriched.logLines ? `<p style="margin:4px 0 4px;font-size:12px;font-weight:600;">Recent log lines</p>${code(enriched.logLines)}` : "") +
      (enriched.dbErrors ? `<p style="margin:8px 0 4px;font-size:12px;font-weight:600;">Recent DB errors</p>${code(enriched.dbErrors)}` : "");
    parts.push(section("Server-side context", serverContent));
  }

  parts.push(
    section(
      "Environment",
      kv("Browser", report.browser) +
        kv("Viewport", report.viewport) +
        kv("Locale", report.locale) +
        kv("TZ", report.timezone),
    ),
  );

  const briefLines: string[] = [];
  if (report.stack) {
    const topFrame = report.stack.split("\n")[1]?.trim() ?? "";
    if (topFrame) briefLines.push(`1. Top stack frame: ${topFrame}`);
  }
  if (report.apiCall) {
    briefLines.push(`2. Handler for ${report.apiCall.method} ${report.apiCall.url}`);
    if (report.apiCall.requestId) {
      briefLines.push(`3. Server logs for request id ${report.apiCall.requestId} around ${report.timestamp}`);
    }
  }
  briefLines.push(`Build: ${report.gitSha ?? "unknown"} (look up in Sentry for source-mapped frames)`);

  parts.push(
    section(
      "Brief for the next engineer / AI",
      `<ul style="margin:0;padding-left:20px;">${briefLines.map((l) => `<li style="font-size:13px;margin:4px 0;">${escapeHtml(l)}</li>`).join("")}</ul>`,
    ),
  );

  return parts.join("\n");
}
