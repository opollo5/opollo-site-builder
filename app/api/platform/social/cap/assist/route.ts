import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { dbUuid, readJsonBody, validationError, internalError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { checkRateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { generateAssistText } from "@/lib/platform/social/cap/assist";

// ---------------------------------------------------------------------------
// POST /api/platform/social/cap/assist — inline AI text generation for the
// composer AI-assistant panel (Spec 22 PR 4).
//
// Generates a single post from a user prompt without creating any DB records.
// Rate limit: 30 calls/company/hour ("cap_assist") keyed on "company:<uuid>".
// Gate: create_post (editor+).
//
// Body: { company_id, prompt, tone, length }
// Response: { ok: true, data: { text: string } }
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BodySchema = z.object({
  company_id: dbUuid(),
  prompt: z.string().min(1).max(500),
  tone: z.enum(["professional", "casual", "playful"]),
  length: z.enum(["short", "medium", "long"]),
  goal: z.enum(["educate", "promote", "announce", "engage"]).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return validationError(
      "Body must be { company_id: uuid, prompt: string, tone: professional|casual|playful, length: short|medium|long }.",
    );
  }

  const { company_id: companyId, prompt, tone, length, goal } = parsed.data;

  const gate = await requireCanDoForApi(companyId, "create_post");
  if (gate.kind === "deny") return gate.response;

  const rl = await checkRateLimit("cap_assist", `company:${companyId}`);
  if (!rl.ok) return rateLimitExceeded(rl);

  logger.info("cap.assist.route.start", { companyId, tone, length, userId: gate.userId });

  const result = await generateAssistText({
    companyId,
    prompt,
    tone,
    length,
    goal: goal ?? undefined,
    requestedBy: gate.userId,
  });

  if (!result.ok) {
    const { category, code, message, trace_id, retry_after, can_retry } = result.error;
    const httpStatus = category === "rate_limit" ? 429 : category === "content_rejected" ? 422 : 500;
    const headers: Record<string, string> = {};
    if (retry_after !== undefined) headers["Retry-After"] = String(retry_after);
    return NextResponse.json(
      { ok: false, error: { category, code, message, trace_id, retry_after, can_retry } },
      { status: httpStatus, headers },
    );
  }

  return NextResponse.json(
    { ok: true, data: { text: result.text }, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
