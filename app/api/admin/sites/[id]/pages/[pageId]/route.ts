import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  PAGE_SLUG_MAX,
  PAGE_SLUG_RE,
  PAGE_TITLE_MAX,
  PAGE_TITLE_MIN,
  updatePageMetadata,
} from "@/lib/pages";
import { errorCodeToStatus } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// PATCH /api/admin/sites/[id]/pages/[pageId] — M6-3.
//
// Metadata edit endpoint. Admin + operator gated. Optimistic-locked
// on `pages.version_lock` — the body carries `expected_version` and
// the UPDATE's WHERE clause pins it. Mismatch → 409 VERSION_CONFLICT
// with the server's current_version.
//
// Accepts any subset of {title, slug}. Slug edits hit the
// `pages_site_slug_unique` constraint the batch generator relies on
// (M3-6's pre-commit claim) — conflicts return 409 UNIQUE_VIOLATION
// with the attempted_slug in the details so the UI can surface a
// friendly "that slug is already taken" message.
//
// `meta_description` is NOT editable here — it's a WordPress-side
// field the quality-gate runner checks in generated HTML, not a
// column on `pages`. Belongs to re-generation (M7).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PatchSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(PAGE_TITLE_MIN)
      .max(PAGE_TITLE_MAX)
      .optional(),
    slug: z
      .string()
      .trim()
      .regex(PAGE_SLUG_RE, {
        message: "Slug must be lowercase letters, digits, and hyphens only.",
      })
      .max(PAGE_SLUG_MAX)
      .optional(),
  })
  .refine((p) => p.title !== undefined || p.slug !== undefined, {
    message: "At least one of title or slug must be provided.",
  });

const BodySchema = z.object({
  expected_version: z.number().int().min(1),
  patch: PatchSchema,
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; pageId: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({
    roles: ["admin", "operator"] as const,
  });
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id) || !UUID_RE.test(params.pageId)) {
    return errorJson(
      "VALIDATION_FAILED",
      "Site id and page id must be UUIDs.",
      400,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Body failed validation.",
          details: { issues: parsed.error.issues },
          retryable: false, // VALIDATION_FAILED is not retryable — same input loops forever (M15-4 #5)
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const result = await updatePageMetadata(params.id, params.pageId, {
    expected_version: parsed.data.expected_version,
    updated_by: gate.user?.id ?? null,
    patch: parsed.data.patch,
  });

  if (!result.ok) {
    const status = errorCodeToStatus(result.error.code);
    return NextResponse.json(
      { ...result, timestamp: result.timestamp },
      { status },
    );
  }

  revalidatePath(`/admin/sites/${params.id}/pages`);
  revalidatePath(`/admin/sites/${params.id}/pages/${params.pageId}`);

  return NextResponse.json(
    { ...result, timestamp: result.timestamp },
    { status: 200 },
  );
}
