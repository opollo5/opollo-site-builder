import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { dbUuid, readJsonBody, respond, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { listVariants, SUPPORTED_PLATFORMS, upsertVariant } from "@/lib/platform/social/variants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

const PutSchema = z.object({
  company_id: dbUuid(),
  platform: z.enum(["linkedin_personal", "linkedin_company", "facebook_page", "x", "gbp"]),
  variant_text: z.string().max(10_000).nullable().optional(),
  media_asset_ids: z.array(z.string().uuid()).max(20).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return validationError("id must be a UUID.");
  const companyId = new URL(req.url).searchParams.get("company_id");
  if (!companyId || !UUID_RE.test(companyId)) {
    return validationError("company_id query parameter (uuid) is required.");
  }

  const gate = await requireCanDoForApi(companyId, "view_calendar");
  if (gate.kind === "deny") return gate.response;

  const result = await listVariants({ postMasterId: id, companyId });
  if (!result.ok) return respond(result);

  return NextResponse.json(
    {
      ok: true,
      data: result.data,
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
  if (!UUID_RE.test(id)) return validationError("id must be a UUID.");

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(
      "Body must be { company_id: uuid, platform: SocialPlatform, variant_text?: string|null }.",
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
  if (!result.ok) return respond(result);

  return NextResponse.json(
    { ok: true, data: { variant: result.data }, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
