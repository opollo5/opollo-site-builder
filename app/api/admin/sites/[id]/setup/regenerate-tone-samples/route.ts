import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { regenerateSamples } from "@/lib/design-discovery/extract-tone";
import { incrementRegenCount } from "@/lib/design-discovery/regen-caps";
import { readJsonBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ToneSchema = z.object({
  formality_level: z.number().min(1).max(5),
  sentence_length: z.union([
    z.literal("short"),
    z.literal("medium"),
    z.literal("long"),
  ]),
  jargon_usage: z.union([
    z.literal("embraced"),
    z.literal("neutral"),
    z.literal("avoided"),
  ]),
  personality_markers: z.array(z.string()),
  avoid_markers: z.array(z.string()),
  target_audience: z.string(),
  style_guide: z.string(),
});

const BodySchema = z.object({
  tone_of_voice: ToneSchema,
  feedback: z.string().max(1000).nullable().optional(),
  attempt: z.number().int().min(1).max(11).default(1),
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

  // Server-side cap (DESIGN-DISCOVERY-FOLLOWUP PR 3). Increment first
  // so the bucket is debited the moment the call lands, regardless of
  // whether the Anthropic call later succeeds.
  const cap = await incrementRegenCount(params.id, "tone_samples");
  if (!cap.ok) {
    if (cap.error.code === "LIMIT_REACHED") {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "LIMIT_REACHED",
            message: cap.error.message,
            retryable: false,
          },
          timestamp: new Date().toISOString(),
        },
        { status: 429 },
      );
    }
    return errorJson(
      cap.error.code,
      cap.error.message,
      cap.error.code === "NOT_FOUND" ? 404 : 500,
    );
  }

  const result = await regenerateSamples(
    parsed.data.tone_of_voice,
    parsed.data.feedback ?? null,
    { siteId: params.id, attempt: parsed.data.attempt },
  );
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
  return NextResponse.json(
    { ok: true, data: { samples: result.samples }, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
