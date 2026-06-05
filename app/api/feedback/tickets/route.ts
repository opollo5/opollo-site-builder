import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createRouteAuthClient } from "@/lib/auth";
import { dbUuid, internalError, readJsonBody, validationError } from "@/lib/http";
import { isCompanyMember, isOpolloStaff } from "@/lib/platform/auth";
import { createTicket } from "@/lib/feedback/tickets/create";
import { listTickets } from "@/lib/feedback/tickets/queries";

// ---------------------------------------------------------------------------
// POST /api/feedback/tickets — create a ticket (member or staff)
// GET  /api/feedback/tickets — list tickets (member: own company; staff: all)
//
// Auth:
//   - Authenticated session required (401 if not).
//   - POST: caller must be a member of the submitted company_id, OR Opollo staff.
//   - GET:  company_id filter is mandatory for non-staff callers (they can only
//     see their own company via RLS anyway). Staff can omit it for cross-company.
//   - priority: never accepted from POST payload; defaults to 'medium' server-side.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  companyId: dbUuid(),
  // title is no longer sent by callers (v1.3) — auto-generated from description.
  title: z.string().max(200).optional(),
  description: z.string().min(1).max(2000),
  severity: z.enum(["low", "normal", "high", "blocker"]).default("normal"),
  tags: z.array(z.string()).default([]),
  assigneeId: dbUuid().nullable().optional(),
  pageUrl: z.string().url(),
  routePattern: z.string().nullable().optional(),
  cssSelector: z.string().min(1),
  elementLabel: z.string().nullable().optional(),
  clickXPct: z.number().min(0).max(100),
  clickYPct: z.number().min(0).max(100),
  viewportW: z.number().int().positive(),
  viewportH: z.number().int().positive(),
  devicePixelRatio: z.number().positive().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  consoleErrors: z.array(z.unknown()).nullable().optional(),
  screenshotObjectPath: z.string().nullable().optional(),
  expectedBehavior: z.string().max(2000).nullable().optional(),
  debugSnapshot: z
    .object({
      buildSha: z.string().nullable(),
      route: z.string(),
      vercelEnv: z.string().nullable(),
      userEmail: z.string().nullable(),
      userAgent: z.string(),
      viewport: z.object({ w: z.number(), h: z.number(), dpr: z.number() }),
      apiEvents: z.array(
        z.object({
          ts: z.number(),
          method: z.string(),
          path: z.string(),
          status: z.number(),
          requestId: z.string().nullable(),
          durationMs: z.number(),
        }),
      ),
    })
    .nullable()
    .optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = createRouteAuthClient();
  const { data: userResp, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResp?.user) {
    return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }
  const userId = userResp.user.id;

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return validationError("Invalid ticket payload.", { issues: parsed.error.issues });
  }

  const input = parsed.data;

  // Auth: must be member of the target company or Opollo staff.
  const [isMember, isStaff] = await Promise.all([
    isCompanyMember(input.companyId, supabase),
    isOpolloStaff(supabase),
  ]);
  if (!isMember && !isStaff) {
    return NextResponse.json(
      { ok: false, error: { code: "FORBIDDEN", message: "Not a member of this company." } },
      { status: 403 },
    );
  }

  // Non-staff cannot set assigneeId.
  if (input.assigneeId && !isStaff) {
    input.assigneeId = null;
  }

  const result = await createTicket(input, userId);
  if (!result.ok) return internalError(result.error);

  return NextResponse.json(
    { ok: true, data: { id: result.ticket.id, status: result.ticket.status }, timestamp: new Date().toISOString() },
    { status: 201 },
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = createRouteAuthClient();
  const { data: userResp, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResp?.user) {
    return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }

  const url = new URL(req.url);
  const params = {
    companyId: url.searchParams.get("companyId") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    severity: url.searchParams.get("severity") ?? undefined,
    priority: url.searchParams.get("priority") ?? undefined,
    assigneeId: url.searchParams.get("assigneeId") ?? undefined,
    hasPr: url.searchParams.has("hasPr")
      ? url.searchParams.get("hasPr") === "true"
      : undefined,
  };

  const staff = await isOpolloStaff(supabase);

  // Non-staff must have a companyId and must be a member of it.
  if (!staff) {
    if (!params.companyId) {
      return validationError("companyId is required for non-staff callers.");
    }
    const member = await isCompanyMember(params.companyId, supabase);
    if (!member) {
      return NextResponse.json(
        { ok: false, error: { code: "FORBIDDEN" } },
        { status: 403 },
      );
    }
  }

  const tickets = await listTickets(params);
  return NextResponse.json(
    { ok: true, data: { tickets }, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
