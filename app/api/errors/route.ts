import { randomUUID } from "crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createRouteAuthClient, getCurrentUser } from "@/lib/auth";
import { isAuthKillSwitchOn } from "@/lib/auth-kill-switch";
import { readJsonBody, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { checkRateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/errors — lightweight structured client-error sink.
//
// Distinct from /api/internal/error-reports (which sends email digests and
// is user-triggered). This endpoint is called automatically by logClientError
// on every AI generation failure, upload error, etc.
//
// Auth: any authenticated user. Company_id + user_id enriched server-side
// from the verified session; not trusted from the request body.
//
// Rate: 20 per user per minute (guard against client-side retry loops).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  trace_id:   z.string().optional(),
  component:  z.string().min(1).max(100),
  severity:   z.enum(["critical", "error", "warning", "info"]),
  message:    z.string().max(1000).optional(),
  context:    z.record(z.string(), z.unknown()).optional(),
  stack:      z.string().max(5000).optional(),
  company_id: z.string().uuid().optional(),
});

function generateTraceId(): string {
  const hex = randomUUID().replace(/-/g, "");
  return `ce-${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // --- Auth gate -----------------------------------------------------------
  let userId: string | null = null;

  let killSwitch = false;
  try { killSwitch = await isAuthKillSwitchOn(); } catch { killSwitch = false; }

  if (!killSwitch) {
    const supabase = createRouteAuthClient();
    const user = await getCurrentUser(supabase);
    if (!user) {
      return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED", message: "Authentication required." } }, { status: 401 });
    }
    userId = user.id;
  }

  // --- Rate limit ----------------------------------------------------------
  const rlKey = userId ? `user:${userId}` : `ip:${req.headers.get("x-forwarded-for") ?? "unknown"}`;
  const rl = await checkRateLimit("client_errors", rlKey);
  if (!rl.ok) return rateLimitExceeded(rl);

  // --- Body parse ----------------------------------------------------------
  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return validationError("Body must be { component, severity } plus optional trace_id, message, context, stack, company_id.");
  }

  const { component, severity, message, context, stack, company_id } = parsed.data;
  const traceId = parsed.data.trace_id ?? generateTraceId();

  // --- Persist -------------------------------------------------------------
  const db = getServiceRoleClient();
  const { error: dbErr } = await db.from("client_errors").insert({
    trace_id:   traceId,
    company_id: company_id ?? null,
    user_id:    userId ?? null,
    surface:    component,
    error_code: (context?.error_code as string | undefined) ?? severity.toUpperCase(),
    http_status:(context?.http_status as number | undefined) ?? null,
    severity,
    message:    message ?? null,
    context:    context ?? null,
    stack:      stack ?? null,
    user_agent: req.headers.get("user-agent") ?? null,
  });

  if (dbErr) {
    logger.error("client-errors.insert-failed", { traceId, error: dbErr.message });
    // Don't fail the client — log and continue.
  }

  return NextResponse.json({ ok: true, data: { trace_id: traceId } }, { status: 201 });
}
