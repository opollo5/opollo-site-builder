import { NextResponse } from "next/server";

import { createRouteAuthClient, getCurrentUser } from "@/lib/auth";
import { readJsonBody, validationError } from "@/lib/http";
import {
  checkRateLimit,
  getClientIp,
  rateLimitExceeded,
} from "@/lib/rate-limit";
import { executeSearchImages } from "@/lib/search-images";
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

  const result = await executeSearchImages(body);
  const status = result.ok ? 200 : errorCodeToStatus(result.error.code);
  return NextResponse.json(result, { status });
}
