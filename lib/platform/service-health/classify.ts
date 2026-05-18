import "server-only";

import type { EventType, Severity } from "./types";

export interface ClassifiedEvent {
  eventType: EventType;
  severity: Severity;
}

/**
 * Maps an HTTP status code + service name to the canonical event_type and
 * severity stored in service_health_events. Called by withHealthMonitoring
 * when a fetch/SDK call throws or returns an error status.
 */
export function classifyHttpError(
  status: number,
  serviceName: string,
): ClassifiedEvent {
  if (status === 401 || status === 403) {
    return { eventType: "auth_failure", severity: "critical" };
  }
  if (status === 402) {
    return { eventType: "billing_failure", severity: "critical" };
  }
  if (status === 429) {
    return { eventType: "rate_limit", severity: "warning" };
  }
  if (status >= 500) {
    // SendGrid 5xx is critical — email delivery is blocked.
    const sev: Severity =
      serviceName === "sendgrid" || serviceName === "bundle-social"
        ? "critical"
        : "warning";
    return { eventType: "service_5xx", severity: sev };
  }
  // Non-HTTP failures (DNS, timeout, ECONNREFUSED)
  return { eventType: "connection_failure", severity: "critical" };
}

/**
 * Maps a thrown error (non-HTTP) to a classified event. Called when the
 * underlying call throws rather than returning a status code.
 */
export function classifyThrownError(_err: unknown): ClassifiedEvent {
  return { eventType: "connection_failure", severity: "critical" };
}
