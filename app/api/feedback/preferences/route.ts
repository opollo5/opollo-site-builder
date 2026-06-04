import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createRouteAuthClient } from "@/lib/auth";
import { getServiceRoleClient } from "@/lib/supabase";
import { readJsonBody, validationError, internalError } from "@/lib/http";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// POST /api/feedback/preferences
//
// Merges a preference key into platform_users.preferences JSONB for the
// authenticated user.  Currently supports { skip_intro: boolean } only.
//
// Auth: authenticated session required.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  skip_intro: z.boolean(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = createRouteAuthClient();
  const { data: userResp, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResp?.user) {
    return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }
  const userId = userResp.user.id;

  const body = await readJsonBody(req);
  const parsed = BodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return validationError("Body must be { skip_intro: boolean }.", { issues: parsed.error.issues });
  }

  const svc = getServiceRoleClient();

  // Read current preferences, merge key, write back.
  const { data: current, error: readErr } = await svc
    .from("platform_users")
    .select("preferences")
    .eq("id", userId)
    .maybeSingle();

  if (readErr) {
    logger.error("feedback.preferences.read_failed", { userId, err: readErr.message });
    return internalError(readErr.message);
  }

  const merged = {
    ...(current?.preferences as Record<string, unknown> ?? {}),
    feedback_skip_intro: parsed.data.skip_intro,
  };

  const { error: writeErr } = await svc
    .from("platform_users")
    .update({ preferences: merged })
    .eq("id", userId);

  if (writeErr) {
    logger.error("feedback.preferences.write_failed", { userId, err: writeErr.message });
    return internalError(writeErr.message);
  }

  logger.info("feedback.preferences.updated", { userId, skip_intro: parsed.data.skip_intro });
  return NextResponse.json({ ok: true, timestamp: new Date().toISOString() }, { status: 200 });
}
