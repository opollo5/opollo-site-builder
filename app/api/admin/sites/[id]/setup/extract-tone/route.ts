import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { extractTone } from "@/lib/design-discovery/extract-tone";
import { readJsonBody } from "@/lib/http";
import { resetRegenCount } from "@/lib/design-discovery/regen-caps";
import {
  AVOID_OPTIONS,
  PERSONALITY_OPTIONS,
} from "@/lib/design-discovery/tone-mapping";
import { logger } from "@/lib/logger";

// POST /api/admin/sites/[id]/setup/extract-tone — admin-gated.
// Body matches ToneInputs in lib/design-discovery/extract-tone.ts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BodySchema = z.object({
  industry: z.string().min(1).max(50),
  existing_content_url: z.string().max(500).nullable(),
  sample_copy: z.string().max(5000).nullable(),
  target_audience: z.string().max(500).nullable(),
  personality: z.array(z.enum(PERSONALITY_OPTIONS)).max(PERSONALITY_OPTIONS.length),
  avoid: z.array(z.enum(AVOID_OPTIONS)).max(AVOID_OPTIONS.length),
  admired_brand: z.string().max(200).nullable(),
});

function errorJson(code: string, message: string, status: number): NextResponse {
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
          message: "Body failed validation.",
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
    result = await extractTone(parsed.data, { siteId: params.id });
  } catch (err) {
    logger.error("design-discovery.extract-tone.unhandled", {
      site_id: params.id,
      message: err instanceof Error ? err.message : String(err),
    });
    return errorJson(
      "INTERNAL_ERROR",
      err instanceof Error ? err.message : "Tone extraction failed.",
      500,
    );
  }

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: result.error.code, message: result.error.message, retryable: true },
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  }

  // Re-extracting tone replaces the existing profile + samples on
  // the client (ToneOfVoiceInputs.onExtract sets regenAttempts to 0
  // locally). Mirror that on the server so the cap budget refreshes
  // for the new tone run too.
  await resetRegenCount(params.id, "tone_samples");

  return NextResponse.json(
    { ok: true, data: result.data, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
