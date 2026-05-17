import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { internalError, readJsonBody, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import {
  processBundlesocialWebhook,
  WebhookEnvelopeSchema,
} from "@/lib/platform/social/webhooks";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/admin/maintenance/webhooks/replay
//
// Replays unprocessed bundle.social webhook events from social_webhook_events.
// Use when webhook delivery was disrupted (network failure, DB downtime, or
// the bundle.social 50-failures auto-disable) and events were stored but not
// acted on.
//
// Bundle.social does NOT offer an API replay — this endpoint is the only
// recovery path for missed events.
//
// Body (all optional):
//   team_id   — replay only events for this team (string)
//   since     — replay only events received after this ISO timestamp
//   limit     — max events to replay per call (default 100, max 500)
//   dry_run   — if true, report what would be replayed but take no action
//
// Returns:
//   { replayed: N, succeeded: M, failed: K, skipped: S, ids: string[] }
//   where ids is the list of social_webhook_events.id rows touched.
//
// Roles: super_admin or admin.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BodySchema = z
  .object({
    team_id:  z.string().optional(),
    since:    z.string().datetime({ offset: true }).optional(),
    limit:    z.number().int().min(1).max(500).optional(),
    dry_run:  z.boolean().optional(),
  })
  .optional();

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const raw = await readJsonBody(req);
  const parsed = BodySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return validationError(
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  const { team_id, since, limit = 100, dry_run = false } = parsed.data ?? {};

  const svc = getServiceRoleClient();

  // Fetch unprocessed events, oldest first so we replay in delivery order.
  let query = svc
    .from("social_webhook_events")
    .select("id, event_id, event_type, team_id, raw_payload, signature_valid, received_at")
    .is("processed_at", null)
    .order("received_at", { ascending: true })
    .limit(limit);

  if (team_id) {
    query = query.eq("team_id", team_id);
  }
  if (since) {
    query = query.gte("received_at", since);
  }

  const { data: rows, error } = await query;
  if (error) {
    logger.error("admin.webhooks.replay.fetch_failed", { err: error.message });
    return internalError(`Failed to fetch unprocessed events: ${error.message}`);
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json(
      {
        ok: true,
        data: { replayed: 0, succeeded: 0, failed: 0, skipped: 0, ids: [] },
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  }

  if (dry_run) {
    return NextResponse.json(
      {
        ok: true,
        data: {
          dry_run: true,
          would_replay: rows.length,
          ids: rows.map((r) => r.id as string),
          types: [...new Set(rows.map((r) => r.event_type as string))],
        },
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  }

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const ids: string[] = [];

  for (const row of rows) {
    const envelopeParsed = WebhookEnvelopeSchema.safeParse(row.raw_payload);
    if (!envelopeParsed.success) {
      logger.warn("admin.webhooks.replay.envelope_invalid", {
        webhook_event_id: row.id,
        event_id: row.event_id,
      });
      skipped++;
      continue;
    }

    const result = await processBundlesocialWebhook({
      envelope: envelopeParsed.data,
      rawPayload: row.raw_payload as Record<string, unknown>,
      signatureValid: Boolean(row.signature_valid),
    });

    ids.push(row.id as string);

    if (result.kind === "ok") {
      succeeded++;
      logger.info("admin.webhooks.replay.replayed", {
        webhook_event_id: row.id,
        action: result.action,
      });
    } else if (result.kind === "already_processed") {
      skipped++;
    } else if (result.kind === "idempotent_insert_failed") {
      failed++;
      logger.error("admin.webhooks.replay.insert_failed", {
        webhook_event_id: row.id,
        message: result.message,
      });
    } else {
      // stored_no_action / validation_failed — counts as skipped (already handled or unparseable)
      skipped++;
    }
  }

  return NextResponse.json(
    {
      ok: true,
      data: {
        replayed: rows.length,
        succeeded,
        failed,
        skipped,
        ids,
      },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
