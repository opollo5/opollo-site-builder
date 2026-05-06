import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { readJsonBody } from "@/lib/http";
import { createPost } from "@/lib/posts";
import { getServiceRoleClient } from "@/lib/supabase";
import { errorCodeToStatus } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// POST /api/sites/[id]/posts — BP-3 entry-point save-draft.
//
// Body: { title, slug, excerpt?, metadata?, design_system_version? }
//
// Creates a draft post for the site. design_system_version defaults to
// the site's currently-active DS version. Returns the new post id +
// detail link so the client can router.push() into the post's edit
// surface.
//
// Admin OR operator role.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BodySchema = z
  .object({
    title: z.string().min(1).max(200),
    slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9-]+$/),
    excerpt: z.string().max(2000).nullable().optional(),
    metadata: z.unknown().optional(),
    // BP-7 — image_library row id chosen via the BP-4 picker.
    featured_image_id: z.string().uuid().nullable().optional(),
    // Operator-edited SEO title (may differ from parser-extracted meta_title).
    meta_title: z.string().max(200).nullable().optional(),
    // "draft" or "scheduled"; "published" goes through /publish route.
    status: z.enum(["draft", "scheduled"]).optional(),
    // ISO datetime string for scheduled posts; stored in metadata.
    scheduled_at: z.string().nullable().optional(),
    // WP term IDs for categories and tags.
    wp_category_ids: z.array(z.number().int().nonnegative()).max(20).optional(),
    wp_tag_ids: z.array(z.number().int().nonnegative()).max(20).optional(),
    // New tag names (not yet created in WP); created on publish.
    wp_new_tag_names: z.array(z.string().min(1).max(200)).max(20).optional(),
    // New category names (not yet created in WP); created on publish.
    wp_new_category_names: z.array(z.string().min(1).max(200)).max(20).optional(),
    // Pre-composed HTML for "Publish immediately" mode.
    generated_html: z.string().max(500_000).nullable().optional(),
  })
  .strict();

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

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return errorJson("VALIDATION_FAILED", "Site id must be a UUID.", 400);
  }

  const body = await readJsonBody(req);
  if (body === undefined) return errorJson("VALIDATION_FAILED", "Request body must be valid JSON.", 400);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(
      "VALIDATION_FAILED",
      "Body failed validation.",
      400,
      { issues: parsed.error.issues },
    );
  }

  // Read the site's active design system version so the post row's
  // design_system_version snapshots the value the operator authored
  // against (matches the brief-runner semantics).
  const svc = getServiceRoleClient();
  const { data: ds } = await svc
    .from("design_systems")
    .select("version")
    .eq("site_id", params.id)
    .eq("status", "active")
    .maybeSingle();
  const dsVersion = Number(ds?.version ?? 1);

  // Merge parser snapshot with operator-edited extended fields so the
  // post's metadata column carries everything needed for the publish path.
  const baseMetadata =
    parsed.data.metadata &&
    typeof parsed.data.metadata === "object" &&
    !Array.isArray(parsed.data.metadata)
      ? (parsed.data.metadata as Record<string, unknown>)
      : {};
  const extendedMetadata: Record<string, unknown> = {
    ...baseMetadata,
    ...(parsed.data.meta_title !== undefined
      ? { meta_title_override: parsed.data.meta_title }
      : {}),
    ...(parsed.data.scheduled_at !== undefined
      ? { scheduled_at: parsed.data.scheduled_at }
      : {}),
    ...(parsed.data.wp_category_ids !== undefined
      ? { wp_category_ids: parsed.data.wp_category_ids }
      : {}),
    ...(parsed.data.wp_tag_ids !== undefined
      ? { wp_tag_ids: parsed.data.wp_tag_ids }
      : {}),
    ...(parsed.data.wp_new_tag_names !== undefined
      ? { wp_new_tag_names: parsed.data.wp_new_tag_names }
      : {}),
    ...(parsed.data.wp_new_category_names !== undefined
      ? { wp_new_category_names: parsed.data.wp_new_category_names }
      : {}),
  };

  const result = await createPost({
    site_id: params.id,
    title: parsed.data.title,
    slug: parsed.data.slug,
    excerpt: parsed.data.excerpt ?? undefined,
    design_system_version: dsVersion,
    status: parsed.data.status,
    metadata: extendedMetadata,
    featured_image_id: parsed.data.featured_image_id ?? undefined,
    created_by: gate.user?.id ?? null,
    ...(parsed.data.generated_html !== undefined && parsed.data.generated_html !== null
      ? { generated_html: parsed.data.generated_html }
      : {}),
  });

  if (!result.ok) {
    const status = errorCodeToStatus(result.error.code);
    return errorJson(
      result.error.code,
      result.error.message,
      status,
      result.error.details,
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: {
        id: result.data.id,
        slug: result.data.slug,
        title: result.data.title,
        edit_url: `/admin/sites/${params.id}/posts/${result.data.id}`,
      },
      timestamp: new Date().toISOString(),
    },
    { status: 201 },
  );
}
