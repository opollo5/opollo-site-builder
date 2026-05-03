import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  approveDesignDirection,
  resetDesignDirection,
} from "@/lib/design-discovery/approve-design";
import { DesignBriefSchema } from "@/lib/design-discovery/design-brief";
import { resetRegenCount } from "@/lib/design-discovery/regen-caps";
import { readJsonBody } from "@/lib/http";

// ---------------------------------------------------------------------------
// POST   /api/admin/sites/[id]/setup/approve-design
//   Body: { brief: DesignBrief, concept: { homepage_html, inner_page_html,
//                                          design_tokens, rationale,
//                                          direction } }
//   Persists the approved concept + flips status to 'approved'.
//
// DELETE /api/admin/sites/[id]/setup/approve-design
//   Resets the approved concept; status flips to 'in_progress'. Used
//   by the spec's "Reset and start over" CTA.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ConceptSchema = z.object({
  homepage_html: z.string().min(50),
  inner_page_html: z.string().min(50),
  design_tokens: z.record(z.string(), z.unknown()),
  rationale: z.string().min(1).max(600),
  direction: z.string().min(1),
});

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
  const wrapper = body as { brief?: unknown; concept?: unknown };
  const briefParsed = DesignBriefSchema.safeParse(wrapper?.brief ?? null);
  const conceptParsed = ConceptSchema.safeParse(wrapper?.concept ?? null);
  if (!briefParsed.success || !conceptParsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Body must be { brief: DesignBrief, concept: ApprovedConcept }.",
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const result = await approveDesignDirection(
    params.id,
    briefParsed.data,
    conceptParsed.data,
  );
  if (!result.ok) {
    return errorJson(
      result.error.code,
      result.error.message,
      result.error.code === "NOT_FOUND" ? 404 : 500,
    );
  }

  revalidatePath(`/admin/sites/${params.id}/setup`);
  revalidatePath(`/admin/sites/${params.id}`);

  return NextResponse.json(
    { ok: true, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return errorJson("VALIDATION_FAILED", "Site id must be a UUID.", 400);
  }

  const result = await resetDesignDirection(params.id);
  if (!result.ok) {
    return errorJson(
      result.error.code,
      result.error.message,
      result.error.code === "NOT_FOUND" ? 404 : 500,
    );
  }

  // "Reset and start over" zeros the concept_refinements bucket so
  // the operator gets a fresh 10-call budget on the next pass.
  // Tolerate a NOT_FOUND-after-reset by ignoring it; the design reset
  // already succeeded and the site clearly exists.
  await resetRegenCount(params.id, "concept_refinements");

  revalidatePath(`/admin/sites/${params.id}/setup`);
  return NextResponse.json(
    { ok: true, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
