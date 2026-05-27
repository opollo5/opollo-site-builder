import { NextResponse } from "next/server";
import { SignJWT } from "jose";

import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { notFound, validateUuidParam, internalError } from "@/lib/http";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET /api/platform/social/drafts/[id]/review-link
//
// Generates a JWT-signed review link for external approvers.
// Token claims: { sub: draftId, purpose: 'review', exp: now+14d }
// ---------------------------------------------------------------------------

const REVIEW_LINK_TTL_SECS = 14 * 24 * 60 * 60; // 14 days

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const idCheck = validateUuidParam(id, "id");
  if (!idCheck.ok) return idCheck.response;

  const svc = getServiceRoleClient();
  const { data: draft } = await svc
    .from("social_post_drafts")
    .select("company_id, state, archived_at")
    .eq("id", idCheck.value)
    .is("archived_at", null)
    .maybeSingle();

  if (!draft) return notFound(`Draft ${id} not found.`);

  // DI-005: review links for non-pending drafts confuse external reviewers and
  // expose stale post content after the post lifecycle has ended.
  if ((draft.state as string) !== "pending_approval") {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "WRONG_STATE",
          message: `Review links can only be generated for drafts in pending_approval state (current: ${draft.state as string}).`,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 409 },
    );
  }

  const gate = await requireCanDoForApi(draft.company_id as string, "edit_post");
  if (gate.kind === "deny") return gate.response;

  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) {
    logger.error("review_link.missing_secret");
    return internalError("Server configuration error.");
  }

  const expiresAt = new Date(Date.now() + REVIEW_LINK_TTL_SECS * 1000);

  try {
    const token = await new SignJWT({ sub: idCheck.value, purpose: "review" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(expiresAt)
      .sign(new TextEncoder().encode(secret));

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.opollo.com";
    const url = `${siteUrl}/review/${token}`;

    return NextResponse.json({
      ok: true,
      data: { url, expires_at: expiresAt.toISOString() },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("review_link.sign_failed", { err: err instanceof Error ? err.message : String(err) });
    return internalError("Failed to generate review link.");
  }
}
