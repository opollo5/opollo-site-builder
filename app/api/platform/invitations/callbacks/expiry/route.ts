import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { logger } from "@/lib/logger";
import { handleExpiryCallback } from "@/lib/platform/invitations";
import { verifyQstashSignature } from "@/lib/qstash";

// ---------------------------------------------------------------------------
// POST /api/platform/invitations/callbacks/expiry — P2-4.
//
// QStash invokes this at the invitation's expires_at (~14 days post-
// creation by default). Verifies the Upstash-Signature header, then:
//   - Atomically transitions status pending → expired and stamps
//     expired_notified_at (handleExpiryCallback enforces the
//     idempotent UPDATE ... WHERE status='pending' clause).
//   - Dispatches an invitation_expired notification (email-only).
//
// Already-accepted or already-revoked invitations are no-ops. The
// dispatch is gated on the atomic UPDATE returning a row, so duplicate
// webhook fires never produce duplicate emails.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BodySchema = z.object({
  invitationId: z.string().uuid(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();

  const verify = await verifyQstashSignature({
    signature: req.headers.get("upstash-signature"),
    rawBody,
  });
  if (!verify.ok) {
    logger.warn("invitations.callback.expiry.unauthorized", {
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

  const result = await handleExpiryCallback({
    invitationId: parsed.invitationId,
  });

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
