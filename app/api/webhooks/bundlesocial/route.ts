import { NextResponse, type NextRequest } from "next/server";

import { verifyBundlesocialSignature } from "@/lib/bundlesocial";
import { logger } from "@/lib/logger";
import {
  processBundlesocialWebhook,
  WebhookEnvelopeSchema,
} from "@/lib/platform/social/webhooks";

// ---------------------------------------------------------------------------
// S1-17 — POST /api/webhooks/bundlesocial
//
// Inbound webhook receiver for bundle.social. Verifies the
// x-signature HMAC header, parses the envelope, and hands off to
// processBundlesocialWebhook for idempotent insert into
// social_webhook_events + side-effect dispatch.
//
// Response policy (matches bundle.social's retry behaviour):
//   - 401 INVALID_SIGNATURE: no signature / bad HMAC. They WILL retry,
//     so this is fine — gives ops a chance to fix env. We do NOT log
//     the body content on signature failure (could be replay attack).
//   - 503 RECEIVER_NOT_CONFIGURED: BUNDLESOCIAL_WEBHOOK_SIGNING_SECRET
//     unset. Returned in dev/test where secret isn't provisioned. They
//     WILL retry — operator can backfill manually.
//   - 400 VALIDATION_FAILED: body unparseable / missing id+type. Returned
//     once; we don't want to keep storing garbage events.
//   - 200 ok: every successful path, including duplicate deliveries
//     (already_processed) and unrecognised event types
//     (stored_no_action). Stops retries.
//   - 500 INTERNAL_ERROR: idempotent insert path failed (DB unreachable).
//     They retry, which is what we want.
//
// Auth: signature verification IS the auth (no platform session). The
// audit script's allowlist learns about verifyBundlesocialSignature.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();

  const verify = await verifyBundlesocialSignature({
    signature: req.headers.get("x-signature"),
    rawBody,
  });
  if (!verify.ok) {
    logger.warn("bundlesocial.webhook.unauthorized", {
      reason: verify.reason,
    });
    if (verify.reason === "no_secret") {
      return errorEnvelope(
        "RECEIVER_NOT_CONFIGURED",
        "BUNDLESOCIAL_WEBHOOK_SIGNING_SECRET is not configured.",
        503,
      );
    }
    return errorEnvelope(
      "INVALID_SIGNATURE",
      "Invalid or missing x-signature.",
      401,
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return errorEnvelope("VALIDATION_FAILED", "Body is not valid JSON.", 400);
  }

  const envelopeParsed = WebhookEnvelopeSchema.safeParse(parsedBody);
  if (!envelopeParsed.success) {
    return errorEnvelope(
      "VALIDATION_FAILED",
      `Webhook envelope did not validate: ${envelopeParsed.error.issues
        .map((i) => i.message)
        .join("; ")}`,
      400,
    );
  }

  const result = await processBundlesocialWebhook({
    envelope: envelopeParsed.data,
    rawPayload: parsedBody,
    signatureValid: true,
  });

  if (result.kind === "idempotent_insert_failed") {
    return errorEnvelope("INTERNAL_ERROR", result.message, 500);
  }
  if (result.kind === "validation_failed") {
    return errorEnvelope("VALIDATION_FAILED", result.message, 400);
  }

  // ok / already_processed / stored_no_action all return 200; the
  // outcome shape lets ops differentiate via x-request-id correlated logs.
  return NextResponse.json(
    {
      ok: true,
      data: result,
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}

function errorEnvelope(
  code: string,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: status >= 500 },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}
