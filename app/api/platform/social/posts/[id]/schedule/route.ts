import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import {
  createScheduleEntry,
  listScheduleEntries,
} from "@/lib/platform/social/scheduling";

// ---------------------------------------------------------------------------
// S1-14 — schedule endpoints scoped to a single post.
//
//   GET /api/platform/social/posts/[id]/schedule?company_id=&include_cancelled=
//     canDo("view_calendar", company_id) (viewer+).
//
//   POST /api/platform/social/posts/[id]/schedule
//     Body { company_id, platform, scheduled_at }
//     canDo("schedule_post", company_id) (approver+). Lib enforces
//     post.state='approved' + future scheduled_at + no double-booking.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

const PostBodySchema = z.object({
  company_id: z.string().uuid(),
  platform: z.enum([
    "linkedin_personal",
    "linkedin_company",
    "facebook_page",
    "x",
    "gbp",
  ]),
  scheduled_at: z.string().datetime(),
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
  const url = new URL(req.url);
  const companyId = url.searchParams.get("company_id");
  if (!companyId || !UUID_RE.test(companyId)) {
    return errorJson(
      "VALIDATION_FAILED",
      "company_id query parameter (uuid) is required.",
      400,
    );
  }
  const includeCancelled = url.searchParams.get("include_cancelled") === "true";

  const gate = await requireCanDoForApi(companyId, "view_calendar");
  if (gate.kind === "deny") return gate.response;

  const result = await listScheduleEntries({
    postMasterId: id,
    companyId,
    includeCancelled,
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
      data: result.data,
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return errorJson("VALIDATION_FAILED", "id must be a UUID.", 400);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(
      "VALIDATION_FAILED",
      "Body must be { company_id: uuid, platform: SocialPlatform, scheduled_at: ISO timestamp }.",
      400,
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
      data: { entry: result.data },
      timestamp: new Date().toISOString(),
    },
    { status: 201 },
  );
}
