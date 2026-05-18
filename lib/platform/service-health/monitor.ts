import "server-only";

import { logger } from "@/lib/logger";
import { classifyHttpError, classifyThrownError } from "./classify";
import { recordHealthEvent, recordRecovery } from "./record";

// Per-service state: tracks whether the last call was a failure so we can
// fire a "recovered" event only on the first success after failures.
const lastCallFailed = new Map<string, boolean>();

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
 * On recovery: if the previous call for this service/operation was a failure,
 * records a "recovered" event.
 */
export async function withHealthMonitoring<T>(
  serviceName: string,
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = `${serviceName}:${operation}`;
  try {
    const result = await fn();

    // Fire recovery event only on the first success after prior failures.
    if (lastCallFailed.get(key)) {
      lastCallFailed.set(key, false);
      // Non-blocking — don't await; recovery recording must not delay the caller.
      void recordRecovery(serviceName, operation);
    }

    return result;
  } catch (err) {
    lastCallFailed.set(key, true);

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
