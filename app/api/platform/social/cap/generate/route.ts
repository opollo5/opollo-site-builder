import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { readJsonBody } from "@/lib/http";
import { logger } from "@/lib/logger";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { checkRateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { generateCAPPosts } from "@/lib/platform/social/cap";
import { SUPPORTED_PLATFORMS } from "@/lib/platform/social/variants/types";

// ---------------------------------------------------------------------------
// POST /api/platform/social/cap/generate — D2 CAP copy generation trigger.
//
// Generates 1–5 social posts from the company's brand profile via Claude
// and creates social_post_master rows with source_type='cap'. Posts land
// in state='draft' and flow through the normal approval pipeline.
//
// Gate: manage_connections is admin-only; we gate CAP on create_post
// (editor+) so MSP editors can trigger generation, not just admins.
//
// Rate limit: 10 triggers/company/24 h (keyed on company:<uuid>).
//
// Body: { company_id, topics?, platforms?, count? }
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BodySchema = z.object({
  company_id: z.string().uuid(),
  topics: z.array(z.string().max(200)).max(10).optional(),
  platforms: z
    .array(z.enum(SUPPORTED_PLATFORMS as [string, ...string[]]))
    .max(SUPPORTED_PLATFORMS.length)
    .optional(),
  count: z.number().int().min(1).max(5).optional(),
});

function errorJson(code: string, message: string, status: number): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code, message, retryable: false }, timestamp: new Date().toISOString() },
    { status },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJsonBody(req);
  if (body === undefined) return errorJson("VALIDATION_FAILED", "Request body must be valid JSON.", 400);

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return errorJson("VALIDATION_FAILED", "Body must be { company_id: uuid, topics?: string[], platforms?: SocialPlatform[], count?: 1-5 }.", 400);
  }

  const { company_id: companyId, topics, platforms, count } = parsed.data;

  const gate = await requireCanDoForApi(companyId, "create_post");
  if (gate.kind === "deny") return gate.response;

  const rl = await checkRateLimit("cap_generate", `company:${companyId}`);
  if (!rl.ok) return rateLimitExceeded(rl);

  logger.info("cap.generate.route.start", { companyId, count, platforms, userId: gate.userId });

  const result = await generateCAPPosts({
    companyId,
    topics,
    platforms: platforms as typeof SUPPORTED_PLATFORMS[number][] | undefined,
    count,
    triggeredBy: gate.userId,
  });

  if (!result.ok) {
    const status = result.error.code === "VALIDATION_FAILED" ? 400 : 500;
    return errorJson(result.error.code, result.error.message, status);
  }

  return NextResponse.json(
    { ok: true, data: { posts: result.posts, count: result.posts.length }, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
