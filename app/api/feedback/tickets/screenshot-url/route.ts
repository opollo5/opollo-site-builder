import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createRouteAuthClient } from "@/lib/auth";
import { readJsonBody, validationError } from "@/lib/http";
import { mintUploadUrl } from "@/lib/feedback/capture/screenshot";

// ---------------------------------------------------------------------------
// POST /api/feedback/tickets/screenshot-url
//
// Mints a short-lived signed upload URL for a screenshot PNG. The client
// uploads directly to Supabase Storage; the returned objectPath is then
// submitted with the ticket creation payload.
//
// Auth: authenticated session only (membership check deferred to ticket create).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  contentType: z.string().default("image/png"),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = createRouteAuthClient();
  const { data: userResp, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResp?.user) {
    return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }

  const body = await readJsonBody(req);
  const parsed = BodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return validationError("Invalid body.", { issues: parsed.error.issues });
  }

  const result = await mintUploadUrl(parsed.data.contentType);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: result.error } },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: { uploadUrl: result.uploadUrl, objectPath: result.objectPath },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
