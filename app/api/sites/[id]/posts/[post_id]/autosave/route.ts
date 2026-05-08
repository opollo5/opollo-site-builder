import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { readJsonBody, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/sites/[id]/posts/[post_id]/autosave — Spec 14 PR B follow-up.
//
// Partial-state autosave endpoint. Accepts any subset of the editable
// post fields (title, slug, generated_html, excerpt, metadata,
// meta_title) and writes them with last-write-wins semantics. Designed
// to pair with `lib/hooks/use-auto-save.ts` so long-form surfaces can
// flush dirty state during the session warning + grace windows.
//
// Why no version_lock CAS:
//
// The operator's local state is the canonical source of truth between
// keystrokes — they don't want a CAS conflict to discard their typing
// just because a second tab raced a stale snapshot. Mutations that
// matter for transactional integrity (publish, unpublish, status flips)
// continue to flow through the dedicated routes, which DO use CAS.
// Autosave is best-effort + idempotent in a way CAS would interfere
// with.
//
// Why a separate sub-route instead of extending /api/sites/[id]/posts:
//
// /api/sites/[id]/posts is the create endpoint and treating PATCH
// semantics as a side-channel there muddies the contract. Sub-route
// keeps autosave's "last-write-wins, no CAS, partial body" shape
// distinct from "create" and from "publish/unpublish".
//
// Auth: super_admin or admin (admin tier — same gate as the sibling
// publish/unpublish routes).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BodySchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    excerpt: z.string().max(2000).nullable().optional(),
    meta_title: z.string().max(200).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    generated_html: z.string().max(500_000).nullable().optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.title !== undefined ||
      v.slug !== undefined ||
      v.excerpt !== undefined ||
      v.meta_title !== undefined ||
      v.metadata !== undefined ||
      v.generated_html !== undefined,
    { message: "Body must include at least one autosaveable field." },
  );

export async function POST(
  req: Request,
  { params }: { params: { id: string; post_id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return validationError("Site id must be a UUID.");
  }
  if (!UUID_RE.test(params.post_id)) {
    return validationError("Post id must be a UUID.");
  }

  const body = await readJsonBody(req);
  if (body === undefined) {
    return validationError("Request body must be valid JSON.");
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return validationError("Body failed validation.", {
      issues: parsed.error.issues,
    });
  }

  const supabase = getServiceRoleClient();

  // Build the update row from the parsed patch. The schema's strict()
  // means unknown keys are already rejected; we only forward the
  // explicit autosaveable fields.
  const updateRow: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (gate.user?.id) {
    updateRow.last_edited_by = gate.user.id;
    updateRow.updated_by = gate.user.id;
  }
  if ("title" in parsed.data) updateRow.title = parsed.data.title;
  if ("slug" in parsed.data) updateRow.slug = parsed.data.slug;
  if ("excerpt" in parsed.data) updateRow.excerpt = parsed.data.excerpt;
  if ("meta_title" in parsed.data) updateRow.meta_title = parsed.data.meta_title;
  if ("metadata" in parsed.data) updateRow.metadata = parsed.data.metadata;
  if ("generated_html" in parsed.data) {
    updateRow.generated_html = parsed.data.generated_html;
  }

  const res = await supabase
    .from("posts")
    .update(updateRow)
    .eq("id", params.post_id)
    .eq("site_id", params.id)
    .is("deleted_at", null)
    // Block autosave on already-published posts. They still go through
    // the publish/unpublish routes with proper CAS — autosave bypassing
    // version_lock would mask concurrent publish state.
    .neq("status", "published")
    .select("id, version_lock, updated_at")
    .maybeSingle();

  if (res.error) {
    // Slug uniqueness collisions (23505) are the only reasonable
    // operator-visible failure here — surface as 409 so the UI can
    // hint the operator to pick a different slug.
    if (res.error.code === "23505") {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "UNIQUE_VIOLATION",
            message: `Slug "${parsed.data.slug}" is already used by another live post on this site.`,
            details: {
              site_id: params.id,
              attempted_slug: parsed.data.slug ?? null,
            },
          },
          timestamp: new Date().toISOString(),
        },
        { status: 409 },
      );
    }
    logger.error("posts.autosave.update_failed", {
      site_id: params.id,
      post_id: params.post_id,
      supabase_error: res.error.message,
    });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to autosave post.",
          details: { supabase_error: res.error.message },
        },
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
  if (!res.data) {
    // Either the post doesn't exist, doesn't belong to the site, has
    // been soft-deleted, or has already been published (the .neq filter
    // excluded published rows).
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message:
            "Post does not exist, belongs to a different site, has been deleted, or is already published.",
        },
        timestamp: new Date().toISOString(),
      },
      { status: 404 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: res.data,
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
