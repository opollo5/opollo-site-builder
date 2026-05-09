import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { readJsonBody, validationError, internalError } from "@/lib/http";
import { getActiveBrandProfile } from "@/lib/platform/brand/get";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import {
  initiateBundlesocialConnect,
  type SocialPlatform,
} from "@/lib/platform/social/connections";

// ---------------------------------------------------------------------------
// S1-16 — POST /api/platform/social/connections/connect
//
// Returns a bundle.social hosted-portal URL the admin's browser opens
// in a popup for OAuth. After the dance completes, bundle.social
// redirects to our /callback handler (?popup=1 flags the callback to
// send a postMessage + window.close() instead of a full-page redirect).
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return validationError(
      "Body must be { company_id: uuid, platforms?: SocialPlatform[] }.",
      { issues: parsed.error.issues },
    );
  }

  const gate = await requireCanDoForApi(
    parsed.data.company_id,
    "manage_connections",
  );
  if (gate.kind === "deny") return gate.response;

  // Use || (not ??) so an empty-string NEXT_PUBLIC_SITE_URL also falls back
  // to the request origin; nullish coalescing would return "" in that case,
  // making redirectUrl a relative path that bundle.social rejects with 400.
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
    new URL(req.url).origin;
  // ?popup=1 tells the callback to send a postMessage + window.close()
  // instead of a full-page redirect back to /connections.
  const redirectUrl =
    `${origin}/api/platform/social/connections/callback` +
    `?company_id=${encodeURIComponent(parsed.data.company_id)}&popup=1`;

  // Fetch branding in parallel — both are graceful-null on miss.
  const [brand, companyRow] = await Promise.all([
    getActiveBrandProfile(parsed.data.company_id),
    getServiceRoleClient()
      .from("platform_companies")
      .select("name")
      .eq("id", parsed.data.company_id)
      .maybeSingle()
      .then((r) => r.data),
  ]);

  const result = await initiateBundlesocialConnect({
    companyId: parsed.data.company_id,
    platforms: (parsed.data.platforms ?? []) as SocialPlatform[],
    redirectUrl,
    logoUrl: brand?.logo_primary_url ?? brand?.logo_icon_url ?? undefined,
    userName: companyRow?.name ?? undefined,
    // TODO: set hidePoweredBy: true once companies have a paid-plan flag.
    language: "en",
  });
  if (!result.ok) {
    if (result.error.code === "VALIDATION_FAILED") return validationError(result.error.message);
    return internalError(result.error.message);
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
