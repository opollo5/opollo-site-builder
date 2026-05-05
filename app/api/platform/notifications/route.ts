import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getCurrentPlatformSession } from "@/lib/platform/auth";
import { getNotifications, markAllRead } from "@/lib/platform/notifications";

// ---------------------------------------------------------------------------
// S1-29 — in-app notification bell API.
//
// GET  /api/platform/notifications?company_id=X
//   Returns the 20 most recent notifications for the current user +
//   their unread count.  Gate: view_calendar (same as posts list).
//
// PATCH /api/platform/notifications?company_id=X
//   Marks all unread notifications as read.  Same gate.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  company_id: z.string().uuid(),
});

function error(code: string, message: string, status: number) {
  return NextResponse.json(
    { ok: false, error: { code, message, retryable: false }, timestamp: new Date().toISOString() },
    { status },
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = QuerySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  if (!params.success) {
    return error("VALIDATION_FAILED", "company_id (UUID) required.", 400);
  }

  const gate = await requireCanDoForApi(params.data.company_id, "view_calendar");
  if (gate.kind === "deny") return gate.response;

  const session = await getCurrentPlatformSession();
  if (!session) return error("UNAUTHORIZED", "Authentication required.", 401);

  const result = await getNotifications({
    userId: session.userId,
    companyId: params.data.company_id,
  });

  if (!result.ok) {
    return error(result.error.code, result.error.message, 500);
  }

  return NextResponse.json({ ok: true, data: result.data, timestamp: new Date().toISOString() });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const params = QuerySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  if (!params.success) {
    return error("VALIDATION_FAILED", "company_id (UUID) required.", 400);
  }

  const gate = await requireCanDoForApi(params.data.company_id, "view_calendar");
  if (gate.kind === "deny") return gate.response;

  const session = await getCurrentPlatformSession();
  if (!session) return error("UNAUTHORIZED", "Authentication required.", 401);

  const result = await markAllRead({
    userId: session.userId,
    companyId: params.data.company_id,
  });

  if (!result.ok) {
    return error(result.error.code, result.error.message, 500);
  }

  return NextResponse.json({ ok: true, data: result.data, timestamp: new Date().toISOString() });
}
