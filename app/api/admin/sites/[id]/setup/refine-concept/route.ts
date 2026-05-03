import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { DesignBriefSchema } from "@/lib/design-discovery/design-brief";
import { regenerateConcept } from "@/lib/design-discovery/generate-concepts";
import { incrementRegenCount } from "@/lib/design-discovery/regen-caps";
import { readJsonBody } from "@/lib/http";
import { logger } from "@/lib/logger";
import { getSite } from "@/lib/sites";

// ---------------------------------------------------------------------------
// POST /api/admin/sites/[id]/setup/refine-concept
//
// Single-direction regenerate. Operator types feedback into the
// refinement textarea; the client appends it to brief.refinement_notes
// and posts here. We fire one Claude call (vs three in generate-
// concepts) using the same prompt + structural constraints; the model
// applies the refinement notes and produces an updated concept.
//
// Body: { brief: DesignBrief, direction: 'minimal'|'dense'|'editorial' }
// Returns: { ok: true, data: ConceptResult } |
//          { ok: false, error: { code, message } }
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DirectionSchema = z.union([
  z.literal("minimal"),
  z.literal("dense"),
  z.literal("editorial"),
]);

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
  const wrapper = body as { brief?: unknown; direction?: unknown };
  const briefParsed = DesignBriefSchema.safeParse(wrapper?.brief ?? null);
  const directionParsed = DirectionSchema.safeParse(wrapper?.direction);
  if (!briefParsed.success || !directionParsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Body must be { brief: DesignBrief, direction: 'minimal'|'dense'|'editorial' }.",
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const siteResult = await getSite(params.id);
  if (!siteResult.ok) {
    return errorJson(
      siteResult.error.code,
      siteResult.error.message,
      siteResult.error.code === "NOT_FOUND" ? 404 : 500,
    );
  }

  // Server-side cap enforcement. Increment FIRST so the count is
  // burned the moment the call lands; if Anthropic later fails the
  // operator still owes that attempt against the cap (matches the
  // intended product behaviour: 10 paid calls per site, not 10
  // successful refinements).
  const cap = await incrementRegenCount(
    siteResult.data.site.id,
    "concept_refinements",
  );
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

  let result;
  try {
    result = await regenerateConcept(briefParsed.data, directionParsed.data, {
      siteId: siteResult.data.site.id,
      siteName: siteResult.data.site.name,
    });
  } catch (err) {
    logger.error("design-discovery.refine-concept.unhandled", {
      site_id: siteResult.data.site.id,
      direction: directionParsed.data,
      message: err instanceof Error ? err.message : String(err),
    });
    return errorJson(
      "INTERNAL_ERROR",
      err instanceof Error ? err.message : "Refinement failed.",
      500,
    );
  }

  if ("message" in result) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "GENERATION_FAILED",
          message: result.message,
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  }

  return NextResponse.json(
    { ok: true, data: result, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
