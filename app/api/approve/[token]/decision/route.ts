import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { recordApprovalDecision } from "@/lib/platform/social/approvals";

// ---------------------------------------------------------------------------
// S1-7 — POST /api/approve/[token]/decision
//
// Public route. Token IS the auth — verifyQstashSignature pattern but
// for approval magic links: SHA-256 hash compared against
// social_approval_recipients.token_hash inside the lib. No canDo gate;
// no Supabase session required.
//
// Body: { decision: 'approved'|'rejected'|'changes_requested', comment? }
//
// State machine + finalisation happen atomically in the migration-0072
// Postgres function. See lib/platform/social/approvals/decisions/record.ts
// for the snapshot of guarantees.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_RE = /^[0-9a-f]{64}$/i;

const Schema = z.object({
  decision: z.enum(["approved", "rejected", "changes_requested"]),
  comment: z.string().max(2000).nullable().optional(),
});

function errorJson(
  code: string,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: false },
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) {
    return errorJson("NOT_FOUND", "This approval link is invalid.", 404);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return errorJson(
      "VALIDATION_FAILED",
      "Body must be { decision: 'approved'|'rejected'|'changes_requested', comment?: string }.",
      400,
    );
  }

  // Best-effort capture of audit fields. Behind a proxy, x-forwarded-
  // for can have a list; we keep the first hop. NEXT_PUBLIC_SITE_URL
  // isn't a useful filter so we keep this loose.
  const xff = req.headers.get("x-forwarded-for");
  const ipAddress =
    xff?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
  const userAgent = req.headers.get("user-agent");

  const result = await recordApprovalDecision({
    rawToken: token,
    decision: parsed.data.decision,
    comment: parsed.data.comment ?? null,
    ipAddress,
    userAgent,
  });

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
