import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { internalError, readJsonBody, routeError, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { acceptInvitation } from "@/lib/platform/invitations";
import { checkRateLimit, getClientIp, rateLimitExceeded } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// POST /api/platform/invitations/accept — P2-3.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AcceptSchema = z.object({
  token: z.string().min(32).max(256),
  email: z.string().email().max(254),
  password: z.string().min(8).max(256),
  full_name: z.string().min(1).max(254),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = await checkRateLimit("invite_accept", `ip:${getClientIp(req)}`);
  if (!rl.ok) return rateLimitExceeded(rl);

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = AcceptSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(
      "Body must be { token: string, email: string, password: string (min 8), full_name: string }.",
      { issues: parsed.error.issues },
    );
  }

  const result = await acceptInvitation({
    rawToken: parsed.data.token,
    email: parsed.data.email,
    password: parsed.data.password,
    fullName: parsed.data.full_name,
  });

  if (!result.ok) {
    const { code, message } = result.error;
    if (code === "INTERNAL_ERROR") {
      logger.error("platform.invitations.accept.failed", { code, message });
      return internalError(message);
    }
    return routeError(code, message);
  }

  return NextResponse.json(
    {
      ok: true,
      data: { user_id: result.userId, company_id: result.companyId, role: result.role },
      timestamp: new Date().toISOString(),
    },
    { status: 201 },
  );
}
