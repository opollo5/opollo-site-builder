import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
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
  const gate = await requireAdminForApi({ roles: ["admin", "operator"] });
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return errorJson("VALIDATION_FAILED", "Site id must be a UUID.", 400);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
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

  const result = await createPost({
    site_id: params.id,
    title: parsed.data.title,
    slug: parsed.data.slug,
    excerpt: parsed.data.excerpt ?? undefined,
    design_system_version: dsVersion,
    metadata: parsed.data.metadata,
    created_by: gate.user?.id ?? null,
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
