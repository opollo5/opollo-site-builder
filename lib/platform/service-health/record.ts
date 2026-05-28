import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import type { RecordEventInput } from "./types";

// Aggregation window: events of the same (service, operation, event_type)
// within this window are merged by incrementing occurrence_count.
const AGGREGATE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Write a service health event to service_health_events.
 *
 * Within the 5-min aggregation window, updates the existing unresolved row
 * (increments occurrence_count + bumps last_seen_at). Outside the window,
 * or when no unresolved row exists, inserts a new row.
 *
 * Never throws — a logging failure must not cascade into the caller.
 */
export async function recordHealthEvent(input: RecordEventInput): Promise<void> {
  try {
    const svc = getServiceRoleClient();
    const windowStart = new Date(Date.now() - AGGREGATE_WINDOW_MS).toISOString();

    // Look for an existing unresolved event in the aggregation window.
    const { data: existing } = await svc
      .from("service_health_events")
      .select("id, occurrence_count")
      .eq("service_name", input.serviceName)
      .eq("event_type", input.eventType)
      .is("resolved_at", null)
      .gte("last_seen_at", windowStart)
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      await svc
        .from("service_health_events")
        .update({
          occurrence_count: existing.occurrence_count + 1,
          last_seen_at: new Date().toISOString(),
          ...(input.operation !== undefined && { operation: input.operation }),
          details: input.details ?? {},
        })
        .eq("id", existing.id);
    } else {
      await svc.from("service_health_events").insert({
        service_name: input.serviceName,
        operation: input.operation ?? null,
        event_type: input.eventType,
        severity: input.severity,
        occurrence_count: 1,
        details: input.details ?? {},
      });
    }
  } catch (err) {
    logger.warn("service_health.record_failed", {
      service: input.serviceName,
      eventType: input.eventType,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Returns true if any unresolved (non-manual) event exists for the given
 * service + operation pair. Used by withHealthMonitoring on the success
 * path to decide whether a `recovered` sweep is warranted, in lieu of an
 * in-memory flag that doesn't survive Vercel function cold-starts.
 *
 * Failures (Supabase error, network blip) return false and log a warning
 * — the success path must not be blocked by a monitoring-table read.
 */
export async function hasUnresolvedHealthEvent(
  serviceName: string,
  operation: string,
): Promise<boolean> {
  try {
    const svc = getServiceRoleClient();
    const { data, error } = await svc
      .from("service_health_events")
      .select("id")
      .eq("service_name", serviceName)
      .eq("operation", operation)
      .is("resolved_at", null)
      .neq("event_type", "manual_flag")
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.warn("service_health.detect_unresolved_failed", {
        service: serviceName,
        operation,
        err: error.message,
      });
      return false;
    }
    return data !== null;
  } catch (err) {
    logger.warn("service_health.detect_unresolved_threw", {
      service: serviceName,
      operation,
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Mark a service as recovered — resolves all open events for the service.
 * Called by withHealthMonitoring on a successful call after prior failures.
 */
export async function recordRecovery(serviceName: string, operation?: string): Promise<void> {
  try {
    const svc = getServiceRoleClient();
    const now = new Date().toISOString();

    await svc
      .from("service_health_events")
      .update({ resolved_at: now })
      .eq("service_name", serviceName)
      .is("resolved_at", null)
      .neq("event_type", "manual_flag");

    // Insert a synthetic "recovered" event for the timeline.
    await svc.from("service_health_events").insert({
      service_name: serviceName,
      operation: operation ?? null,
      event_type: "recovered",
      severity: "info",
      occurrence_count: 1,
      details: {},
    });
  } catch (err) {
    logger.warn("service_health.recovery_record_failed", {
      service: serviceName,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
