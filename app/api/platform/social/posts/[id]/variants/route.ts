import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { readJsonBody } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import {
  listVariants,
  SUPPORTED_PLATFORMS,
  upsertVariant,
} from "@/lib/platform/social/variants";

// ---------------------------------------------------------------------------
// S1-4 — variant endpoints scoped to a single post.
//
//   GET /api/platform/social/posts/[id]/variants?company_id=...
//     canDo("view_calendar", company_id) (viewer+).
//     Returns master_text + per-platform resolved variants.
//
//   PUT /api/platform/social/posts/[id]/variants
//     Body { company_id, platform, variant_text? }
//     canDo("edit_post", company_id) (editor+). Lib enforces draft-only.
//     Empty / omitted variant_text clears the override.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

const PutSchema = z.object({
  company_id: z.string().uuid(),
  platform: z.enum([
    "linkedin_personal",
    "linkedin_company",
    "facebook_page",
    "x",
    "gbp",
  ]),
  variant_text: z.string().max(10_000).nullable().optional(),
  // S1-24: media attachments. Pass undefined to leave the existing
  // array untouched; pass [] to clear; pass [uuid, ...] to overwrite.
  media_asset_ids: z.array(z.string().uuid()).max(20).optional(),
});

function errorJson(
  code: string,
  message: string,
  status: number,
  details?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message,
        retryable: false,
        ...(details ? { details } : {}),
      },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

function statusForCode(code: string): number {
  switch (code) {
    case "VALIDATION_FAILED":
      return 400;
    case "NOT_FOUND":
      return 404;
    case "INVALID_STATE":
      return 409;
    default:
      return 500;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return errorJson("VALIDATION_FAILED", "id must be a UUID.", 400);
  }
  const companyId = new URL(req.url).searchParams.get("company_id");
  if (!companyId || !UUID_RE.test(companyId)) {
    return errorJson(
      "VALIDATION_FAILED",
      "company_id query parameter (uuid) is required.",
      400,
    );
  }

  const gate = await requireCanDoForApi(companyId, "view_calendar");
  if (gate.kind === "deny") return gate.response;

  const result = await listVariants({ postMasterId: id, companyId });
  if (!result.ok) {
    return errorJson(
      result.error.code,
      result.error.message,
      statusForCode(result.error.code),
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: result.data,
      // Echo the supported set so the client can render unconfigured
      // platforms even if the data array is somehow short.
      meta: { supported_platforms: SUPPORTED_PLATFORMS },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return errorJson("VALIDATION_FAILED", "id must be a UUID.", 400);
  }

  const body = await readJsonBody(req);
  if (body === undefined) return errorJson("VALIDATION_FAILED", "Request body must be valid JSON.", 400);
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(
      "VALIDATION_FAILED",
      "Body must be { company_id: uuid, platform: SocialPlatform, variant_text?: string|null }.",
      400,
      { issues: parsed.error.issues },
    );
  }

  const gate = await requireCanDoForApi(parsed.data.company_id, "edit_post");
  if (gate.kind === "deny") return gate.response;

  const result = await upsertVariant({
    postMasterId: id,
    companyId: parsed.data.company_id,
    platform: parsed.data.platform,
    variantText: parsed.data.variant_text ?? null,
    mediaAssetIds: parsed.data.media_asset_ids,
  });
  if (!result.ok) {
    return errorJson(
      result.error.code,
      result.error.message,
      statusForCode(result.error.code),
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: { variant: result.data },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
