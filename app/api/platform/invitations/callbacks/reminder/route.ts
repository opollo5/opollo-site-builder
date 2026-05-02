import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { logger } from "@/lib/logger";
import { handleReminderCallback } from "@/lib/platform/invitations";
import { verifyQstashSignature } from "@/lib/qstash";

// ---------------------------------------------------------------------------
// POST /api/platform/invitations/callbacks/reminder — P2-4.
//
// QStash invokes this 3 days after invitation creation with body
// { invitationId, rawToken }. Verifies the Upstash-Signature header,
// then dispatches an invitation_reminder notification (email-only,
// per EVENT_CHANNELS in lib/platform/notifications/types.ts).
//
// Idempotency lives in handleReminderCallback: the atomic UPDATE ...
// WHERE reminder_sent_at IS NULL ensures duplicate webhook fires (a
// QStash retry, or a network blip causing QStash to re-send) only
// dispatch one email. Always returns 200 once the signature is
// verified — QStash retries on 5xx, so a transient DB blip + a 5xx
// would re-fire and the idempotency layer would handle it cleanly.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BodySchema = z.object({
  invitationId: z.string().uuid(),
  rawToken: z.string().min(1).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Read raw body for signature verification — must be the exact bytes
  // QStash signed. Do not consume req.json() before verifying.
  const rawBody = await req.text();

  const verify = await verifyQstashSignature({
    signature: req.headers.get("upstash-signature"),
    rawBody,
  });
  if (!verify.ok) {
    logger.warn("invitations.callback.reminder.unauthorized", {
      reason: verify.reason,
    });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code:
            verify.reason === "no_receiver"
              ? "RECEIVER_NOT_CONFIGURED"
              : "INVALID_SIGNATURE",
          message: "Invalid or missing Upstash-Signature.",
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: verify.reason === "no_receiver" ? 503 : 401 },
    );
  }

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(JSON.parse(rawBody));
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: `Invalid body: ${err instanceof Error ? err.message : String(err)}`,
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const result = await handleReminderCallback({
    invitationId: parsed.invitationId,
    rawToken: parsed.rawToken,
  });

  // 200 across the board (including no-ops) so QStash treats the
  // webhook as delivered and stops retrying. Internal errors return
  // 500 so QStash retries — the idempotency layer ensures retries
  // are safe.
  if (result.outcome === "internal_error") {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: result.message ?? "callback handler failed",
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: { outcome: result.outcome, invitationId: result.invitationId },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
