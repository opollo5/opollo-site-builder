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
import { preflightSitePublish } from "@/lib/site-preflight";
import { getServiceRoleClient } from "@/lib/supabase";
import { getSite } from "@/lib/sites";
import {
  wpCreatePost,
  wpUpdatePost,
  type WpConfig,
} from "@/lib/wordpress";
import {
  uploadFeaturedMedia,
  WpFeaturedMediaError,
} from "@/lib/wp-featured-media";

// ---------------------------------------------------------------------------
// M13-4 — POST /api/sites/[id]/posts/[post_id]/publish
//
// Publishes (or re-publishes) an Opollo post to WordPress. Two paths:
//
//   - wp_post_id is NULL: first publish. wpCreatePost with status='publish'.
//     Opollo UPDATE records the returned WP id + status='published' +
//     published_at=now() under version_lock CAS.
//
//   - wp_post_id is set: re-publish (e.g., operator edited the draft and
//     wants the updated content on WP). wpUpdatePost with status='publish'.
//     Opollo UPDATE refreshes published_at only; wp_post_id + status
//     don't need to flip.
//
// Preflight runs FIRST. If the stored app password can't edit_posts or
// upload_files, or REST is unreachable, the publish is refused with a
// typed blocker the UI renders as a translated message. No raw 401/403
// ever reaches the operator.
//
// Body:
//   { expected_version_lock: int }
//
// Responses:
//   200 { post_id, wp_post_id, status, published_at, preview_url }
//   403 { code: "PREFLIGHT_BLOCKED", details: { blocker } }  — translated
//   404 NOT_FOUND — post missing / wrong site
//   409 VERSION_CONFLICT — stale expected_version_lock
//   502 WP_API_ERROR — WP returned a non-401/404 failure post-preflight
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PublishBodySchema = z.object({
  expected_version_lock: z.number().int().nonnegative(),
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
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const siteIdCheck = validateUuidParam(params.id, "id");
  if (!siteIdCheck.ok) return siteIdCheck.response;
  const postIdCheck = validateUuidParam(params.post_id, "post_id");
  if (!postIdCheck.ok) return postIdCheck.response;

  const body = await readJsonBody(req);
  const parsed = parseBodyWith(PublishBodySchema, body);
  if (!parsed.ok) return parsed.response;

  const svc = getServiceRoleClient();

  // 1. Look up the post. site_id must match the URL site id (defence-
  //    in-depth — the operator crafting a URL by hand can't publish
  //    another site's post).
  const postRes = await svc
    .from("posts")
    .select(
      "id, site_id, slug, title, excerpt, status, wp_post_id, generated_html, version_lock, metadata, featured_image_id, featured_wp_media_id",
    )
    .eq("id", postIdCheck.value)
    .is("deleted_at", null)
    .maybeSingle();
  if (postRes.error) {
    logger.error("posts.publish.lookup_failed", {
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
    slug: string;
    title: string;
    excerpt: string | null;
    status: string;
    wp_post_id: number | null;
    generated_html: string | null;
    version_lock: number;
    // BP-7 — metadata IS NOT NULL marks an entry-point post; gates the
    // FEATURED_IMAGE_REQUIRED rule. Legacy brief-runner posts have NULL.
    metadata: unknown | null;
    featured_image_id: string | null;
    featured_wp_media_id: number | null;
  };
  if (post.site_id !== siteIdCheck.value) {
    return envelope(
      "NOT_FOUND",
      `Post ${postIdCheck.value} does not belong to site ${siteIdCheck.value}.`,
      404,
    );
  }
  if (!post.generated_html || post.generated_html.trim() === "") {
    return envelope(
      "INVALID_STATE",
      "Post has no generated_html yet; run generation and approve before publishing.",
      409,
    );
  }

  // 2. Run preflight. A blocker halts here with translated copy.
  const preflight = await preflightSitePublish(siteIdCheck.value);
  if (!preflight.ok) {
    logger.info("posts.publish.preflight_blocked", {
      site_id: siteIdCheck.value,
      post_id: postIdCheck.value,
      blocker_code: preflight.blocker.code,
    });
    return envelope(
      "PREFLIGHT_BLOCKED",
      preflight.blocker.detail,
      403,
      { blocker: preflight.blocker },
    );
  }

  // 3. Resolve WP config (site credentials) for the publish call. We
  //    re-read via getSite rather than re-using preflight's output so
  //    this route controls its own auth load — a long gap between
  //    preflight + publish is rare but possible.
  const siteRes = await getSite(siteIdCheck.value, { includeCredentials: true });
  if (!siteRes.ok) {
    return envelope(siteRes.error.code, siteRes.error.message, 500);
  }
  const siteRow = siteRes.data.site as { wp_url: string };
  const creds = siteRes.data.credentials;
  if (!creds) {
    return envelope(
      "INTERNAL_ERROR",
      "Site has no WP credentials after preflight passed.",
      500,
    );
  }
  const cfg: WpConfig = {
    baseUrl: siteRow.wp_url,
    user: creds.wp_user,
    appPassword: creds.wp_app_password,
  };

  // 3.5 BP-7: featured-image gate + transfer.
  //
  // Entry-point posts (metadata IS NOT NULL) MUST have a featured image
  // selected. Legacy brief-runner posts (metadata IS NULL) skip the
  // gate so existing publish paths don't regress.
  const isEntryPointPost = post.metadata !== null;
  if (isEntryPointPost && post.featured_image_id === null) {
    return envelope(
      "FEATURED_IMAGE_REQUIRED",
      "This post needs a featured image. Pick one in the post editor before publishing.",
      422,
    );
  }

  let featuredMediaId: number | null = post.featured_wp_media_id;
  let stampedFeaturedMedia = false;
  if (post.featured_image_id !== null && featuredMediaId === null) {
    // First-time transfer. Look up the image_library row, fetch the
    // bytes from Cloudflare, push to WP /media. The wp_media_id stamp
    // happens in step 5 alongside the publish-state CAS so a partial
    // commit doesn't orphan a successful transfer.
    const imgRes = await svc
      .from("image_library")
      .select("cloudflare_id, filename")
      .eq("id", post.featured_image_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (imgRes.error || !imgRes.data || !imgRes.data.cloudflare_id) {
      return envelope(
        "FEATURED_IMAGE_NOT_FOUND",
        "Featured image is missing from the library. Pick another image in the editor.",
        422,
      );
    }
    const marker = `opollo-post-${post.id.replace(/-/g, "")}`;
    try {
      const uploaded = await uploadFeaturedMedia(cfg, {
        cloudflareId: imgRes.data.cloudflare_id as string,
        filename: (imgRes.data.filename as string | null) ?? null,
        marker,
      });
      featuredMediaId = uploaded.wp_media_id;
      stampedFeaturedMedia = true;
    } catch (err) {
      if (err instanceof WpFeaturedMediaError) {
        logger.warn("posts.publish.featured_media_failed", {
          post_id: post.id,
          code: err.code,
          retryable: err.retryable,
        });
        return envelope(
          err.code === "WP_AUTH_FAILED" ? "AUTH_FAILED" : "WP_API_ERROR",
          `Featured image transfer failed: ${err.message}`,
          err.code === "WP_AUTH_FAILED" ? 401 : err.retryable ? 502 : 422,
        );
      }
      throw err;
    }
  }

  // 4. Publish / re-publish via WP REST.
  const excerptValue = post.excerpt ?? undefined;
  const featuredMediaPatch =
    featuredMediaId !== null ? { featured_media: featuredMediaId } : {};
  const wpResult = post.wp_post_id
    ? await wpUpdatePost(cfg, post.wp_post_id, {
        title: post.title,
        slug: post.slug,
        content: post.generated_html,
        ...(excerptValue !== undefined ? { excerpt: excerptValue } : {}),
        ...featuredMediaPatch,
        status: "publish",
      })
    : await wpCreatePost(cfg, {
        title: post.title,
        slug: post.slug,
        content: post.generated_html,
        ...(excerptValue !== undefined ? { excerpt: excerptValue } : {}),
        ...featuredMediaPatch,
        status: "publish",
      });
  if (!wpResult.ok) {
    const translated = translateWpError(wpResult);
    logger.warn("posts.publish.wp_rest_failed", {
      post_id: postIdCheck.value,
      wp_code: wpResult.code,
      wp_message: wpResult.message,
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

  // 5. Write Opollo state under version_lock CAS. First-publish path
  //    sets wp_post_id; re-publish leaves it intact. Both refresh
  //    published_at.
  const nowIso = new Date().toISOString();
  const updatePatch: Record<string, unknown> = {
    status: "published",
    published_at: nowIso,
    updated_at: nowIso,
    last_edited_by: gate.user?.id ?? null,
    version_lock: parsed.data.expected_version_lock + 1,
  };
  if (!post.wp_post_id) {
    updatePatch.wp_post_id = wpResult.post_id;
  }
  // BP-7 — stamp the WP media id so re-publish reuses the existing
  // attachment instead of re-uploading the same bytes.
  if (stampedFeaturedMedia && featuredMediaId !== null) {
    updatePatch.featured_wp_media_id = featuredMediaId;
  }

  const upd = await svc
    .from("posts")
    .update(updatePatch)
    .eq("id", post.id)
    .eq("version_lock", parsed.data.expected_version_lock)
    .select("id, wp_post_id, status, published_at")
    .maybeSingle();
  if (upd.error) {
    if ((upd.error as { code?: string }).code === "23505") {
      return envelope(
        "UNIQUE_VIOLATION",
        "Another post on this site already claims the same wp_post_id. Check for concurrent publish races.",
        409,
      );
    }
    logger.error("posts.publish.cas_update_failed", {
      post_id: post.id,
      error: upd.error,
    });
    return envelope(
      "INTERNAL_ERROR",
      "Post published to WP but Opollo state update failed. See logs.",
      500,
    );
  }
  if (!upd.data) {
    return envelope(
      "VERSION_CONFLICT",
      "The post was edited while you were publishing. Refresh and retry.",
      409,
    );
  }

  // 6. Revalidate the admin surfaces so the published state renders.
  revalidatePath(`/admin/sites/${siteIdCheck.value}/posts`);
  revalidatePath(`/admin/sites/${siteIdCheck.value}/posts/${post.id}`);
  revalidatePath(`/admin/sites/${siteIdCheck.value}`);

  return NextResponse.json(
    {
      ok: true,
      data: {
        post_id: post.id,
        wp_post_id: upd.data.wp_post_id,
        status: upd.data.status,
        published_at: upd.data.published_at,
        // `link` is the WP URL — useful for the publish-confirm modal's
        // "view on WordPress" link.
        preview_url:
          "link" in wpResult && typeof wpResult.link === "string"
            ? wpResult.link
            : null,
      },
      timestamp: nowIso,
    },
    { status: 200 },
  );
}
