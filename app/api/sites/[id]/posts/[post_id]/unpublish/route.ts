import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { translateWpError } from "@/lib/error-translations";
import {
  parseBodyWith,
  readJsonBody,
  validateUuidParam,
} from "@/lib/http";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import { getSite } from "@/lib/sites";
import { wpDeletePost, type WpConfig } from "@/lib/wordpress";

// ---------------------------------------------------------------------------
// M13-4 — POST /api/sites/[id]/posts/[post_id]/unpublish
//
// Reverts a published post on the WP side to trash (recoverable via
// WP admin → Trash). Opollo flips status back to 'draft' and clears
// published_at. wp_post_id is PRESERVED so a future re-publish lands
// on the same WP row (restores via /wp-admin if the operator wants
// to go back).
//
// This is a destructive operator action — the UI MUST render a confirm
// modal before POSTing per docs/patterns/assistive-operator-flow.md.
// The route itself is a straight-through mutation; confirmation is a
// UI concern.
//
// Body:
//   { expected_version_lock: int, force?: boolean }
//
// `force: true` bypasses WP's trash and hard-deletes the WP post.
// Default (false) trashes, which is recoverable. Opollo recommends
// default; force is reserved for "permanent delete" ops-level actions.
//
// Responses:
//   200 { post_id, status, wp_post_id }   (wp_post_id preserved)
//   404 NOT_FOUND — post missing / wrong site / already-draft
//   409 VERSION_CONFLICT — stale expected_version_lock
//   502 WP_API_ERROR — WP returned a non-auth failure
//
// Idempotency: unpublishing a post already in 'draft' status returns
// 409 INVALID_STATE (the UI shouldn't offer the button in that state
// anyway; 409 is belt-and-suspenders against a double-click race).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UnpublishBodySchema = z.object({
  expected_version_lock: z.number().int().nonnegative(),
  force: z.boolean().optional(),
});

function envelope(
  code: string,
  message: string,
  status: number,
  details?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: false, details },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

export async function POST(
  req: Request,
  { params }: { params: { id: string; post_id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["admin", "operator"] });
  if (gate.kind === "deny") return gate.response;

  const siteIdCheck = validateUuidParam(params.id, "id");
  if (!siteIdCheck.ok) return siteIdCheck.response;
  const postIdCheck = validateUuidParam(params.post_id, "post_id");
  if (!postIdCheck.ok) return postIdCheck.response;

  const body = await readJsonBody(req);
  const parsed = parseBodyWith(UnpublishBodySchema, body);
  if (!parsed.ok) return parsed.response;

  const svc = getServiceRoleClient();

  const postRes = await svc
    .from("posts")
    .select("id, site_id, status, wp_post_id, version_lock")
    .eq("id", postIdCheck.value)
    .is("deleted_at", null)
    .maybeSingle();
  if (postRes.error) {
    logger.error("posts.unpublish.lookup_failed", {
      post_id: postIdCheck.value,
      error: postRes.error,
    });
    return envelope("INTERNAL_ERROR", "Failed to look up post.", 500);
  }
  if (!postRes.data) {
    return envelope("NOT_FOUND", `No post ${postIdCheck.value}.`, 404);
  }
  const post = postRes.data as {
    id: string;
    site_id: string;
    status: string;
    wp_post_id: number | null;
    version_lock: number;
  };
  if (post.site_id !== siteIdCheck.value) {
    return envelope("NOT_FOUND", "Post does not belong to this site.", 404);
  }
  if (post.status !== "published") {
    return envelope(
      "INVALID_STATE",
      `Post is in status '${post.status}', not 'published'.`,
      409,
    );
  }
  if (!post.wp_post_id) {
    // State anomaly — published without a wp_post_id. Shouldn't happen
    // post-publish route, but cover it. Treat as a no-op on WP + flip
    // Opollo state back to draft.
    const nowIso = new Date().toISOString();
    const upd = await svc
      .from("posts")
      .update({
        status: "draft",
        published_at: null,
        updated_at: nowIso,
        last_edited_by: gate.user?.id ?? null,
        version_lock: parsed.data.expected_version_lock + 1,
      })
      .eq("id", post.id)
      .eq("version_lock", parsed.data.expected_version_lock)
      .select("status")
      .maybeSingle();
    if (!upd.data) {
      return envelope("VERSION_CONFLICT", "Refresh and retry.", 409);
    }
    revalidatePath(`/admin/sites/${siteIdCheck.value}/posts/${post.id}`);
    return NextResponse.json(
      {
        ok: true,
        data: { post_id: post.id, status: "draft", wp_post_id: null },
        timestamp: nowIso,
      },
      { status: 200 },
    );
  }

  // Resolve WP config.
  const siteRes = await getSite(siteIdCheck.value, { includeCredentials: true });
  if (!siteRes.ok) {
    return envelope(siteRes.error.code, siteRes.error.message, 500);
  }
  const siteRow = siteRes.data.site as { wp_url: string };
  const creds = siteRes.data.credentials;
  if (!creds) {
    logger.error("posts.unpublish.creds_missing", {
      site_id: siteIdCheck.value,
      post_id: postIdCheck.value,
    });
    return envelope("INTERNAL_ERROR", "Site has no WP credentials.", 500);
  }
  const cfg: WpConfig = {
    baseUrl: siteRow.wp_url,
    user: creds.wp_user,
    appPassword: creds.wp_app_password,
  };

  const force = parsed.data.force === true;
  const wpResult = await wpDeletePost(cfg, post.wp_post_id, { force });
  if (!wpResult.ok) {
    const translated = translateWpError(wpResult);
    logger.warn("posts.unpublish.wp_rest_failed", {
      post_id: post.id,
      wp_code: wpResult.code,
    });
    return envelope(
      wpResult.code === "AUTH_FAILED"
        ? "AUTH_FAILED"
        : wpResult.code === "NOT_FOUND"
          ? "NOT_FOUND"
          : "WP_API_ERROR",
      translated.detail,
      wpResult.code === "AUTH_FAILED"
        ? 401
        : wpResult.code === "NOT_FOUND"
          ? 404
          : 502,
      { translated },
    );
  }

  const nowIso = new Date().toISOString();
  const upd = await svc
    .from("posts")
    .update({
      status: "draft",
      published_at: null,
      updated_at: nowIso,
      last_edited_by: gate.user?.id ?? null,
      version_lock: parsed.data.expected_version_lock + 1,
    })
    .eq("id", post.id)
    .eq("version_lock", parsed.data.expected_version_lock)
    .select("id, status, wp_post_id")
    .maybeSingle();
  if (upd.error) {
    logger.error("posts.unpublish.cas_update_failed", {
      post_id: post.id,
      error: upd.error,
    });
    return envelope(
      "INTERNAL_ERROR",
      "WP trashed the post but Opollo state didn't flip. Refresh and retry.",
      500,
    );
  }
  if (!upd.data) {
    return envelope(
      "VERSION_CONFLICT",
      "The post was edited while you were unpublishing. Refresh and retry.",
      409,
    );
  }

  revalidatePath(`/admin/sites/${siteIdCheck.value}/posts`);
  revalidatePath(`/admin/sites/${siteIdCheck.value}/posts/${post.id}`);

  return NextResponse.json(
    {
      ok: true,
      data: {
        post_id: post.id,
        status: upd.data.status,
        wp_post_id: upd.data.wp_post_id,
        force_deleted: force,
      },
      timestamp: nowIso,
    },
    { status: 200 },
  );
}
