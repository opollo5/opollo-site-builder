import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { internalError, notFound, readJsonBody, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { retryPublishAttempt } from "@/lib/platform/social/publishing";
import { getServiceRoleClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const PostBodySchema = z.object({ company_id: z.string().uuid() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return validationError("id must be a UUID.");

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) return validationError("Body must be { company_id: uuid }.");

  const gate = await requireCanDoForApi(parsed.data.company_id, "schedule_post");
  if (gate.kind === "deny") return gate.response;

  const svc = getServiceRoleClient();
  const attempt = await svc
    .from("social_publish_attempts")
    .select("publish_job_id")
    .eq("id", id)
    .maybeSingle();
  if (attempt.error || !attempt.data) return notFound("Attempt not found.");
  const job = await svc
    .from("social_publish_jobs")
    .select("company_id")
    .eq("id", attempt.data.publish_job_id as string)
    .maybeSingle();
  if (job.error || !job.data || (job.data.company_id as string) !== parsed.data.company_id) {
    return notFound("Attempt not found.");
  }

  const result = await retryPublishAttempt({ attemptId: id });
  if (!result.ok) {
    if (result.error.code === "VALIDATION_FAILED") return validationError(result.error.message);
    return internalError(result.error.message);
  }

  return NextResponse.json(
    { ok: true, data: result.data, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
