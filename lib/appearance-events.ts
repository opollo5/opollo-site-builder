import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// M13-5a — appearance_events audit-log writer.
//
// Thin wrapper over the supabase insert that enforces the CHECK-enum
// event names at the TypeScript level so M13-5c/d/e callers can't
// typo themselves into an INSERT that 23514s at runtime.
//
// The helper never throws on insert failure: an audit-log write
// failing is a logging concern, not a contract violation, and the
// callers (install / sync / rollback routes) have already completed
// their write-safety-critical work before they call this.
//
// The `logAppearanceEvent` name is intentional — this is the log-
// write entry point; `readLatestAppearanceEvent` in a sibling module
// will land with M13-5d's rollback path.
// ---------------------------------------------------------------------------

export const APPEARANCE_EVENT_TYPES = [
  // Preflight visibility — operator ran the capability probe.
  "preflight_run",
  // Kadence install flow (M13-5c).
  "install_dry_run",
  "install_confirmed",
  "install_completed",
  "install_failed",
  // Palette sync flow (M13-5d).
  "globals_dry_run",
  "globals_confirmed",
  "globals_completed",
  "globals_failed",
  // Rollback flow (M13-5d).
  "rollback_requested",
  "rollback_completed",
  "rollback_failed",
] as const;

export type AppearanceEventType = (typeof APPEARANCE_EVENT_TYPES)[number];

export type AppearanceEventInput = {
  site_id: string;
  event: AppearanceEventType;
  /** Free-form but per-event-type shape conventions; see migration 0022 comment. */
  details?: Record<string, unknown>;
  created_by?: string | null;
};

export type AppearanceEventRow = {
  id: string;
  site_id: string;
  event: AppearanceEventType;
  details: Record<string, unknown>;
  created_at: string;
  created_by: string | null;
};

/**
 * Append one row to appearance_events. Logs a warning (not an error)
 * on insert failure — the caller has already completed its critical
 * work by the time this runs.
 *
 * Returns { ok: true, id } on success, { ok: false, reason } on
 * failure. Callers that care (tests; the rollback path) can branch;
 * route handlers typically ignore the return.
 */
export async function logAppearanceEvent(
  input: AppearanceEventInput,
): Promise<
  { ok: true; id: string } | { ok: false; reason: string }
> {
  const svc = getServiceRoleClient();
  const res = await svc
    .from("appearance_events")
    .insert({
      site_id: input.site_id,
      event: input.event,
      details: input.details ?? {},
      created_by: input.created_by ?? null,
    })
    .select("id")
    .single();
  if (res.error) {
    logger.warn("appearance_events.insert_failed", {
      site_id: input.site_id,
      event: input.event,
      error: res.error,
    });
    return { ok: false, reason: res.error.message };
  }
  return { ok: true, id: res.data.id as string };
}

/**
 * Read the most recent N events for a site. Used by the Appearance
 * panel's event-log surface. Returns newest first.
 */
export async function listAppearanceEventsForSite(
  site_id: string,
  limit: number = 20,
): Promise<AppearanceEventRow[]> {
  const svc = getServiceRoleClient();
  const res = await svc
    .from("appearance_events")
    .select("id, site_id, event, details, created_at, created_by")
    .eq("site_id", site_id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (res.error) {
    logger.warn("appearance_events.list_failed", {
      site_id,
      error: res.error,
    });
    return [];
  }
  return (res.data ?? []) as AppearanceEventRow[];
}
