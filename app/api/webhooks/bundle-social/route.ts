import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/webhooks/bundle-social
//
// bundle.social publish-status webhook. Verifies HMAC-SHA256 signature
// from X-Bundle-Social-Signature header, then updates social_post_drafts.
// ---------------------------------------------------------------------------

function verifySignature(body: string, signature: string): boolean {
  const secret = process.env.BUNDLE_SOCIAL_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  try {
    return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const signature = req.headers.get("x-bundle-social-signature") ?? "";

  if (!verifySignature(rawBody, signature)) {
    logger.warn("webhook.bundle_social_signature_invalid");
    return NextResponse.json({ ok: false, error: "Invalid signature." }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const { event_type, post_external_id, status, error_message, post_url } = payload as {
    event_type?: string;
    post_external_id?: string;
    status?: string;
    error_message?: string;
    post_url?: string;
  };

  if (!post_external_id) {
    return NextResponse.json({ ok: true }); // unknown post, ack and ignore
  }

  const svc = getServiceRoleClient();

  if (status === "published" || event_type === "post.published") {
    await svc
      .from("social_post_drafts")
      .update({
        state: "published",
        published_at: new Date().toISOString(),
        published_url: post_url ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", post_external_id);
  } else if (status === "failed" || event_type === "post.failed") {
    // Increment attempts; if >= 3 → failed, else back to scheduled.
    const { data: draft } = await svc
      .from("social_post_drafts")
      .select("publish_attempts")
      .eq("id", post_external_id)
      .maybeSingle();

    const attempts = ((draft?.publish_attempts as number | null) ?? 0) + 1;
    const newState = attempts >= 3 ? "failed" : "scheduled";

    await svc
      .from("social_post_drafts")
      .update({
        state: newState,
        publish_attempts: attempts,
        last_publish_error: { code: "PUBLISH_FAILED", message: error_message ?? "Unknown error", attempted_at: new Date().toISOString(), attempt_number: attempts },
        updated_at: new Date().toISOString(),
      })
      .eq("id", post_external_id);
  }

  logger.info("webhook.bundle_social_processed", { event_type, post_external_id, status });
  return NextResponse.json({ ok: true });
}
