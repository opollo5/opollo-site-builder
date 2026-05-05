import { NextResponse, type NextRequest } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { DesignBriefSchema } from "@/lib/design-discovery/design-brief";
import { generateConcepts } from "@/lib/design-discovery/generate-concepts";
import { readJsonBody } from "@/lib/http";
import { logger } from "@/lib/logger";
import { getSite } from "@/lib/sites";

// ---------------------------------------------------------------------------
// POST /api/admin/sites/[id]/setup/generate-concepts
//
// Fires three parallel Anthropic calls (Minimal / Conversion /
// Editorial) and returns the resulting concepts. The operator's
// brief is passed in the body — this endpoint does not read the
// stored design_brief column. PR 7's approve flow persists the
// chosen concept; this endpoint is stateless w.r.t. concept data.
//
// Body: { brief: DesignBrief }
// Returns: { ok: true, data: { concepts: [...], errors: [...] } }
//
// Admin-only.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Generation is bursty (3 parallel × ~30s upper bound). Lift the
// default route timeout to make sure the response lands.
export const maxDuration = 120;

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
  const wrapper = body as { brief?: unknown };
  const parsed = DesignBriefSchema.safeParse(wrapper?.brief ?? null);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "brief failed validation.",
          details: { issues: parsed.error.issues },
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
  const site = siteResult.data.site;

  let result;
  try {
    result = await generateConcepts(parsed.data, {
      siteId: site.id,
      siteName: site.name,
    });
  } catch (err) {
    logger.error("design-discovery.generate-concepts.unhandled", {
      site_id: site.id,
      message: err instanceof Error ? err.message : String(err),
    });
    return errorJson(
      "INTERNAL_ERROR",
      err instanceof Error ? err.message : "Concept generation failed.",
      500,
    );
  }

  if (result.concepts.length === 0) {
    // All three concepts failed — surface as a soft error so the UI
    // can show a retry banner per the spec ("All 3 fail → error
    // banner + retry button, no blank state").
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "GENERATION_FAILED",
          message:
            result.errors.length > 0
              ? `All three concepts failed: ${result.errors.map((e) => e.label + ": " + e.message).join(" | ")}`
              : "No concepts produced.",
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: result,
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
