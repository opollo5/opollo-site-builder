import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { extractFromScreenshots } from "@/lib/design-discovery/extract-screenshots";
import { readJsonBody } from "@/lib/http";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// POST /api/admin/sites/[id]/setup/extract-screenshots
//
// Driven by Step-1's screenshot upload zone. Operator drops up to 5
// images, the client base64-encodes them in memory, posts the array
// here. We fan out to the vision lib (single Claude call), return the
// merged design signals so the form can overlay them on the mood
// board.
//
// Images are NOT persisted — they live in component state, in
// transit they're inlined into the Anthropic call. The redaction in
// lib/anthropic-call.ts:redactMessagesForTrace ensures the bytes
// never reach Langfuse.
//
// Body: { screenshots: Array<{ data: string; media_type: ... }> }
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Mirror lib/design-discovery/extract-screenshots.ts ScreenshotInput
// keep both in sync.
const MediaTypeSchema = z.union([
  z.literal("image/png"),
  z.literal("image/jpeg"),
  z.literal("image/webp"),
  z.literal("image/gif"),
]);

// 5MB per image, base64 = 4/3 * raw → ~6.67MB ASCII. Cap raw payload
// envelope at ~36MB total for 5 images.
const MAX_BASE64_BYTES = Math.ceil((5 * 1024 * 1024 * 4) / 3);

const BodySchema = z.object({
  screenshots: z
    .array(
      z.object({
        data: z.string().min(1).max(MAX_BASE64_BYTES),
        media_type: MediaTypeSchema,
      }),
    )
    .min(1)
    .max(5),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorJson(
  code: string,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: false },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return errorJson("VALIDATION_FAILED", "Site id must be a UUID.", 400);
  }

  const body = await readJsonBody(req);
  if (body === undefined) return errorJson("VALIDATION_FAILED", "Request body must be valid JSON.", 400);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Body must be { screenshots: [{ data, media_type }, ...] }.",
          details: { issues: parsed.error.issues },
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await extractFromScreenshots(parsed.data.screenshots, {
      siteId: params.id,
    });
  } catch (err) {
    logger.error("design-discovery.extract-screenshots.unhandled", {
      site_id: params.id,
      message: err instanceof Error ? err.message : String(err),
    });
    return errorJson(
      "INTERNAL_ERROR",
      err instanceof Error ? err.message : "Vision extraction failed.",
      500,
    );
  }

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: { ...result.error, retryable: true },
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
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
