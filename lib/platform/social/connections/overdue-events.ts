import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

import type { SocialConnection } from "./types";

// ---------------------------------------------------------------------------
// connection_channel_overdue audit event emitter.
//
// Channel-selection flow (incident 2026-05-12): when a connection sits
// in 'pending_identity' for more than 24 hours, the customer-facing
// page renders a yellow callout asking the user to pick a channel.
// First render per connection emits a `connection_channel_overdue`
// platform_events row so operators can spot stuck connections.
//
// Idempotency is row-level via the `has_emitted_overdue_event` boolean
// column (migration 0123). This helper walks a list of connections,
// emits for ones that qualify, and flips the flag in the same write.
// Callers receive the patched list back so the rendered UI matches DB
// state without a re-fetch.
// ---------------------------------------------------------------------------

const OVERDUE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export function isChannelOverdue(conn: SocialConnection): boolean {
  if (conn.status !== "pending_identity") return false;
  // The clock starts when the row was inserted (connected_at). Pending
  // rows older than 24h are considered overdue.
  const age = Date.now() - new Date(conn.connected_at).getTime();
  return age > OVERDUE_THRESHOLD_MS;
}

export async function emitOverdueEventsIfNeeded(
  connections: SocialConnection[],
): Promise<SocialConnection[]> {
  const targets = connections.filter(
    (c) => isChannelOverdue(c) && !c.has_emitted_overdue_event,
  );
  if (targets.length === 0) return connections;

  const svc = getServiceRoleClient();
  // Best-effort per-row; failures don't surface to the user — the
  // banner still renders, the next page load retries.
  for (const c of targets) {
    try {
      await svc.from("platform_events").insert({
        event_type: "connection_channel_overdue",
        company_id: c.company_id,
        actor_id: null,
        entity_type: "social_connection",
        entity_id: c.id,
        payload: {
          platform: c.platform,
          bundle_social_account_id: c.bundle_social_account_id,
          connected_at: c.connected_at,
          overdue_for_ms: Date.now() - new Date(c.connected_at).getTime(),
        },
      });
      await svc
        .from("social_connections")
        .update({ has_emitted_overdue_event: true })
        .eq("id", c.id);
    } catch (err) {
      logger.warn("social.connections.overdue_emit_failed", {
        connection_id: c.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Return a patched copy so callers don't render the flag as stale.
  const updatedIds = new Set(targets.map((t) => t.id));
  return connections.map((c) =>
    updatedIds.has(c.id) ? { ...c, has_emitted_overdue_event: true } : c,
  );
}
