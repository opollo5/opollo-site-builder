import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { internalError, routeError, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { runPostHistoryImport } from "@/lib/platform/social/analytics-ingest";
import { verifyQstashSignature } from "@/lib/qstash";

// ---------------------------------------------------------------------------
// POST /api/webhooks/qstash/social-post-history-import
//
// QStash callback. Fires once enqueuePostHistoryImport queued the job —
// then drives the import end-to-end (postImportCreate, poll until
// COMPLETED, seed snapshot rows).
//
// The runner caps polling at ~14 minutes (under Vercel's 300s function
// timeout — see maxDuration below). If bundle.social hasn't completed
// by then, the row flips to status='timeout' and the dashboard's
// "Re-run import" affordance can re-enqueue.
//
// Response policy:
//   - 401 INVALID_SIGNATURE / 503 RECEIVER_NOT_CONFIGURED
//   - 400 VALIDATION_FAILED
//   - 200 ok on every successful path (succeeded / timeout / skipped /
//     failed) — failed is a terminal state recorded on the row, not a
//     retryable QStash error.
//   - 500 INTERNAL_ERROR when something unexpected blows up.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BodySchema = z.object({
  importRowId: z.string().uuid(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();

  const verify = await verifyQstashSignature({
    signature: req.headers.get("upstash-signature"),
    rawBody,
  });
  if (!verify.ok) {
    logger.warn("social.analytics.post_history_import.unauthorized", {
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

  try {
    const result = await runPostHistoryImport({
      importRowId: parsed.importRowId,
    });
    return NextResponse.json(
      { ok: true, data: result, timestamp: new Date().toISOString() },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("social.analytics.post_history_import.runner_failed", {
      err: message,
      import_row_id: parsed.importRowId,
    });
    return internalError(message);
  }
}
