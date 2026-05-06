import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { readJsonBody, respond, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { createScheduleEntry, listScheduleEntries } from "@/lib/platform/social/scheduling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

const PostBodySchema = z.object({
  company_id: z.string().uuid(),
  platform: z.enum(["linkedin_personal", "linkedin_company", "facebook_page", "x", "gbp"]),
  scheduled_at: z.string().datetime(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return validationError("id must be a UUID.");
  const url = new URL(req.url);
  const companyId = url.searchParams.get("company_id");
  if (!companyId || !UUID_RE.test(companyId)) {
    return validationError("company_id query parameter (uuid) is required.");
  }
  const includeCancelled = url.searchParams.get("include_cancelled") === "true";

  const gate = await requireCanDoForApi(companyId, "view_calendar");
  if (gate.kind === "deny") return gate.response;

  const result = await listScheduleEntries({ postMasterId: id, companyId, includeCancelled });
  if (!result.ok) return respond(result);

  return NextResponse.json(
    { ok: true, data: result.data, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return validationError("id must be a UUID.");

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return validationError(
      "Body must be { company_id: uuid, platform: SocialPlatform, scheduled_at: ISO timestamp }.",
      { issues: parsed.error.issues },
    );
  }

  const gate = await requireCanDoForApi(parsed.data.company_id, "schedule_post");
  if (gate.kind === "deny") return gate.response;

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ??
    new URL(req.url).origin;

  const result = await createScheduleEntry({
    postMasterId: id,
    companyId: parsed.data.company_id,
    platform: parsed.data.platform,
    scheduledAt: parsed.data.scheduled_at,
    scheduledBy: gate.userId,
    origin,
  });
  if (!result.ok) return respond(result);

  return NextResponse.json(
    { ok: true, data: { entry: result.data }, timestamp: new Date().toISOString() },
    { status: 201 },
  );
}
