import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { readJsonBody } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import {
  createViewerLink,
  listViewerLinks,
} from "@/lib/platform/social/viewer-links";

// ---------------------------------------------------------------------------
// S1-15 — viewer-link admin endpoints.
//
//   GET /api/platform/social/viewer-links?company_id=&include_inactive=
//     canDo("manage_invitations") — admin-only.
//
//   POST /api/platform/social/viewer-links
//     Body { company_id, recipient_email?, recipient_name?, expires_at? }
//     canDo("manage_invitations"). Returns the link row + raw token.
//     Caller surfaces the URL (origin + /viewer/<rawToken>) to the
//     admin who shares it externally.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

const PostBodySchema = z.object({
  company_id: z.string().uuid(),
  recipient_email: z.string().email().max(254).nullable().optional(),
  recipient_name: z.string().max(200).nullable().optional(),
  expires_at: z.string().datetime().optional(),
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

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const companyId = url.searchParams.get("company_id");
  if (!companyId || !UUID_RE.test(companyId)) {
    return errorJson(
      "VALIDATION_FAILED",
      "company_id query parameter (uuid) is required.",
      400,
    );
  }
  const includeInactive = url.searchParams.get("include_inactive") === "true";

  const gate = await requireCanDoForApi(companyId, "manage_invitations");
  if (gate.kind === "deny") return gate.response;

  const result = await listViewerLinks({ companyId, includeInactive });
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJsonBody(req);
  if (body === undefined) return errorJson("VALIDATION_FAILED", "Request body must be valid JSON.", 400);
  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(
      "VALIDATION_FAILED",
      "Body must be { company_id: uuid, recipient_email?, recipient_name?, expires_at? }.",
      400,
      { issues: parsed.error.issues },
    );
  }

  const gate = await requireCanDoForApi(
    parsed.data.company_id,
    "manage_invitations",
  );
  if (gate.kind === "deny") return gate.response;

  const result = await createViewerLink({
    companyId: parsed.data.company_id,
    recipientEmail: parsed.data.recipient_email ?? null,
    recipientName: parsed.data.recipient_name ?? null,
    expiresAt: parsed.data.expires_at,
    createdBy: gate.userId,
  });
  if (!result.ok) {
    return errorJson(
      result.error.code,
      result.error.message,
      statusForCode(result.error.code),
    );
  }

  // Build the public URL the admin shares. Origin pinned via
  // NEXT_PUBLIC_SITE_URL (production-correct), falls back to the
  // request origin for dev / preview.
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ??
    new URL(req.url).origin;
  const url = `${origin}/viewer/${result.data.rawToken}`;

  return NextResponse.json(
    {
      ok: true,
      data: { link: result.data.link, url },
      timestamp: new Date().toISOString(),
    },
    { status: 201 },
  );
}
