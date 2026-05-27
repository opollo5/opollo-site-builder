import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { internalError, routeError, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { fireScheduledPublish } from "@/lib/platform/social/publishing";
import { verifyQstashSignature } from "@/lib/qstash";

// ---------------------------------------------------------------------------
// S1-18 — POST /api/webhooks/qstash/social-publish
//
// QStash callback. Fires at the schedule entry's scheduled_at, triggers
// the atomic claim_publish_job RPC + bundle.social postCreate via
// fireScheduledPublish.
//
// Response policy (matches QStash retry behaviour):
//   - 401 INVALID_SIGNATURE: bad/missing Upstash-Signature.
//   - 503 RECEIVER_NOT_CONFIGURED: signing key unset (dev/test).
//   - 400 VALIDATION_FAILED: body parse failure.
//   - 200 ok: every successful path including no-op outcomes
//     (already_claimed / cancelled / invalid_state). Stops QStash retries.
//   - 500 INTERNAL_ERROR: claim_publish_job RPC failure (DB unreachable).
//     QStash retries.
//
// Auth: signature verification IS the auth. Allowlisted in
// scripts/audit.ts via verifyQstashSignature.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BodySchema = z.object({
  scheduleEntryId: z.string().uuid(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();

  const verify = await verifyQstashSignature({
    signature: req.headers.get("upstash-signature"),
    rawBody,
  });
  if (!verify.ok) {
    logger.warn("social.publish.callback.unauthorized", {
      reason: verify.reason,
    });
    if (verify.reason === "no_receiver") {
      return routeError(
        "RECEIVER_NOT_CONFIGURED",
        "QSTASH_CURRENT_SIGNING_KEY is not configured.",
      );
    }
    return routeError(
      "INVALID_SIGNATURE",
      "Invalid or missing Upstash-Signature.",
    );
  }

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(JSON.parse(rawBody));
  } catch (err) {
    return validationError(
      `Invalid body: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  logger.info("social.publish.v1_callback.received", {
    scheduleEntryId: parsed.scheduleEntryId,
    note: "V1 QStash pipeline draining — pr-13",
  });

  const result = await fireScheduledPublish({
    scheduleEntryId: parsed.scheduleEntryId,
  });

  if (!result.ok) {
    if (result.error.code === "VALIDATION_FAILED") {
      return validationError(result.error.message);
    }
    // INTERNAL_ERROR returns 500 so QStash retries.
    logger.error("social.publish.callback.fire_failed", {
      err: result.error.message,
      scheduleEntryId: parsed.scheduleEntryId,
    });
    return internalError(result.error.message);
  }

  return NextResponse.json(
    {
      ok: true,
      data: result.data,
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
