import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { logger } from "@/lib/logger";
import { handleReminderCallback } from "@/lib/platform/workflow/approval-callbacks";
import { verifyQstashSignature } from "@/lib/qstash";

// ---------------------------------------------------------------------------
// POST /api/platform/approvals/callbacks/reminder — Phase-2 workflow.
//
// QStash invokes this at day 3, 7, and 14 after approval request creation
// with body { approvalRequestId, day }. Verifies the Upstash-Signature
// header, then dispatches a reminder email to internal approvers.
//
// Idempotency: handleReminderCallback uses atomic UPDATE ...
// WHERE reminder_dayN_sent_at IS NULL so duplicate webhook fires
// (QStash retries on 5xx) never send duplicate emails.
//
// Returns 200 for all non-error outcomes (including no-ops) so QStash
// treats the webhook as delivered. Returns 500 on internal errors to
// trigger QStash retry.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BodySchema = z.object({
  approvalRequestId: z.string().uuid(),
  day: z.union([z.literal(3), z.literal(7), z.literal(14)]),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Read raw body first — must be the exact bytes QStash signed.
  const rawBody = await req.text();

  const verify = await verifyQstashSignature({
    signature: req.headers.get("upstash-signature"),
    rawBody,
  });
  if (!verify.ok) {
    logger.warn("approvals.callback.reminder.unauthorized", {
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
    approvalRequestId: parsed.approvalRequestId,
    day: parsed.day,
  });

  if (result.outcome === "internal_error") {
    logger.error("approvals.callback.reminder.handler_failed", {
      message: result.message,
      approvalRequestId: parsed.approvalRequestId,
      day: parsed.day,
    });
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
      data: {
        outcome: result.outcome,
        approvalRequestId: result.approvalRequestId,
      },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
