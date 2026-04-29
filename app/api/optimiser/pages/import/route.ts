import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { checkAdminAccess } from "@/lib/admin-gate";
import {
  checkRateLimit,
  getClientIp,
  rateLimitExceeded,
} from "@/lib/rate-limit";
import { submitPageImport } from "@/lib/optimiser/page-import/submit-import";

// OPTIMISER PHASE 1.5 SLICE 17 — POST /api/optimiser/pages/import.
//
// Operator (or onboarding "Try auto-import" button) provides a URL
// + the target client + the destination site. Server fetches the
// HTML, inserts a brief + brief_pages (mode='import') + brief_runs
// triple, returns the run id. UI polls the existing brief-run
// progress endpoints to surface state.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z
  .object({
    url: z.string().url().max(2000),
    client_id: z.string().uuid(),
    site_id: z.string().uuid(),
    landing_page_id: z.string().uuid().nullable().optional(),
    title: z.string().min(1).max(200).optional(),
  })
  .strict();

export async function POST(req: NextRequest): Promise<NextResponse> {
  const access = await checkAdminAccess({
    requiredRoles: ["admin", "operator"],
  });
  if (access.kind === "redirect") {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Not authorised" } },
      { status: 401 },
    );
  }

  // Reuse the test_connection bucket — same shape (per-actor outbound
  // fetch to a customer URL) and keeps the rate-limit surface tight.
  const rlId = access.user
    ? `user:${access.user.id}`
    : `ip:${getClientIp(req)}`;
  const rl = await checkRateLimit("test_connection", rlId);
  if (!rl.ok) return rateLimitExceeded(rl);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Body must include url, client_id, and site_id.",
          details: { issues: parsed.error.issues },
        },
      },
      { status: 400 },
    );
  }

  const result = await submitPageImport({
    url: parsed.data.url,
    client_id: parsed.data.client_id,
    site_id: parsed.data.site_id,
    landing_page_id: parsed.data.landing_page_id ?? null,
    title: parsed.data.title,
    actor_user_id: access.user?.id ?? null,
  });

  if (result.ok) {
    return NextResponse.json({ ok: true, data: result });
  }
  return NextResponse.json(
    { ok: false, error: result.error },
    {
      status:
        result.error.code === "INVALID_URL"
          ? 400
          : result.error.code === "HTTP_ERROR"
            ? 502
            : result.error.code === "BODY_TOO_LARGE"
              ? 413
              : 500,
    },
  );
}
