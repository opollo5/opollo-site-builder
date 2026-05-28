import "server-only";

import { logger } from "@/lib/logger";
import { classifyHttpError, classifyThrownError } from "./classify";
import {
  hasUnresolvedHealthEvent,
  recordHealthEvent,
  recordRecovery,
} from "./record";

/**
 * Wrap any external API call in health monitoring.
 *
 * Usage:
 *   const result = await withHealthMonitoring("bundle-social", "publish", () =>
 *     bundleSocialClient.publishPost(params),
 *   );
 *
 * On error: records a service_health_event and re-throws so the caller can
 * handle the failure. The monitoring layer never swallows errors.
 *
 * On success: queries service_health_events for any unresolved row matching
 * this service + operation. If one exists, fires a `recovered` event +
 * resolves all unresolved rows for the service. The previous in-memory flag
 * (lastCallFailed Map) was per-process and never survived Vercel function
 * cold-starts, so recovery never fired in production. A single SELECT on
 * the indexed (service_name, event_type) WHERE resolved_at IS NULL partial
 * index is the cross-process replacement.
 */
export async function withHealthMonitoring<T>(
  serviceName: string,
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    const result = await fn();

    // Cross-process recovery sweep: any unresolved row for this service +
    // operation triggers recordRecovery. Non-blocking — never await; recovery
    // recording must not delay the caller. hasUnresolvedHealthEvent returns
    // false on its own errors so a DB blip doesn't break the success path.
    if (await hasUnresolvedHealthEvent(serviceName, operation)) {
      void recordRecovery(serviceName, operation);
    }

    return result;
  } catch (err) {
    // Extract HTTP status if the error carries one.
    const status =
      typeof (err as { status?: unknown }).status === "number"
        ? (err as { status: number }).status
        : typeof (err as { statusCode?: unknown }).statusCode === "number"
          ? (err as { statusCode: number }).statusCode
          : null;

    const classified = status !== null
      ? classifyHttpError(status, serviceName)
      : classifyThrownError(err);

    logger.warn("service_health.call_failed", {
      service: serviceName,
      operation,
      status,
      eventType: classified.eventType,
      severity: classified.severity,
      err: err instanceof Error ? err.message : String(err),
    });

    // Record non-blocking; monitoring must not add latency on the error path.
    void recordHealthEvent({
      serviceName,
      operation,
      eventType: classified.eventType,
      severity: classified.severity,
      details: {
        status,
        message: err instanceof Error ? err.message : String(err),
      },
    });

    throw err;
  }
}
