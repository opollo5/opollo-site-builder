import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { readJsonBody } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import {
  initiateBundlesocialConnect,
  type SocialPlatform,
} from "@/lib/platform/social/connections";

// ---------------------------------------------------------------------------
// S1-16 — POST /api/platform/social/connections/connect
//
// Returns a bundle.social hosted-portal URL the admin's browser is
// redirected to for OAuth. After the dance completes, bundle.social
// redirects to our /callback handler with success/error params; the
// callback syncs newly-connected accounts back into social_connections.
//
// Body:
//   { company_id: uuid, platforms?: SocialPlatform[] }
//   - platforms[] empty/omitted = portal shows all configured types.
//
// Gate: canDo("manage_connections", company_id) — admin-only.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PostBodySchema = z.object({
  company_id: z.string().uuid(),
  platforms: z
    .array(
      z.enum([
        "linkedin_personal",
        "linkedin_company",
        "facebook_page",
        "x",
        "gbp",
      ]),
    )
    .optional(),
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJsonBody(req);
  if (body === undefined) return errorJson("VALIDATION_FAILED", "Request body must be valid JSON.", 400);
  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(
      "VALIDATION_FAILED",
      "Body must be { company_id: uuid, platforms?: SocialPlatform[] }.",
      400,
      { issues: parsed.error.issues },
    );
  }

  const gate = await requireCanDoForApi(
    parsed.data.company_id,
    "manage_connections",
  );
  if (gate.kind === "deny") return gate.response;

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ??
    new URL(req.url).origin;
  const redirectUrl = `${origin}/api/platform/social/connections/callback?company_id=${encodeURIComponent(parsed.data.company_id)}`;

  const result = await initiateBundlesocialConnect({
    companyId: parsed.data.company_id,
    platforms: (parsed.data.platforms ?? []) as SocialPlatform[],
    redirectUrl,
  });
  if (!result.ok) {
    const status = result.error.code === "VALIDATION_FAILED" ? 400 : 500;
    return errorJson(result.error.code, result.error.message, status);
  }

  return NextResponse.json(
    {
      ok: true,
      data: { url: result.data.url },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
