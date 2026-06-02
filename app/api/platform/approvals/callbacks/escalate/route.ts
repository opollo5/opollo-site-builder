import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { logger } from "@/lib/logger";
import { handleEscalateCallback } from "@/lib/platform/workflow/approval-callbacks";
import { verifyQstashSignature } from "@/lib/qstash";

// ---------------------------------------------------------------------------
// POST /api/platform/approvals/callbacks/escalate — Phase-2 workflow.
//
// QStash invokes this at day 14 after approval request creation with body
// { approvalRequestId }. Verifies the Upstash-Signature header, then fires
// an admin alert if the request is still open.
//
// Idempotency: handleEscalateCallback uses atomic UPDATE ...
// WHERE admin_alerted_at IS NULL so duplicate fires never double-alert.
//
// Returns 200 for all non-error outcomes (including no-ops). Returns 500
// on internal errors to trigger QStash retry.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BodySchema = z.object({
  approvalRequestId: z.string().uuid(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();

  const verify = await verifyQstashSignature({
    signature: req.headers.get("upstash-signature"),
    rawBody,
  });
  if (!verify.ok) {
    logger.warn("approvals.callback.escalate.unauthorized", {
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

  const result = await handleEscalateCallback({
    approvalRequestId: parsed.approvalRequestId,
  });

  if (result.outcome === "internal_error") {
    logger.error("approvals.callback.escalate.handler_failed", {
      message: result.message,
      approvalRequestId: parsed.approvalRequestId,
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
