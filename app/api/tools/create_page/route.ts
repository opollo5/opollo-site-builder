import { NextResponse } from "next/server";

import { createRouteAuthClient, getCurrentUser } from "@/lib/auth";
import { readJsonBody, validationError } from "@/lib/http";
import { executeCreatePage } from "@/lib/create-page";
import { logger } from "@/lib/logger";
import {
  checkRateLimit,
  getClientIp,
  rateLimitExceeded,
} from "@/lib/rate-limit";
import { errorCodeToStatus } from "@/lib/tool-schemas";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = createRouteAuthClient();
  const user = await getCurrentUser(supabase);
  const rlId = user ? `user:${user.id}` : `ip:${getClientIp(req)}`;
  const rl = await checkRateLimit("tools", rlId);
  if (!rl.ok) return rateLimitExceeded(rl);

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");

  const result = await executeCreatePage(body);
  if (!result.ok) logger.error("executeCreatePage failed", { code: result.error.code });
  const status = result.ok ? 200 : errorCodeToStatus(result.error.code);
  return NextResponse.json(result, { status });
}
