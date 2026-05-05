import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { readJsonBody, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// POST /api/admin/sites/[id]/setup/extract/save
//
// Persists the operator-reviewed extraction snapshot. Sets
// design_direction_status='approved' so the existing
// design-discovery downstream code that checks that flag treats the
// site as fully set up.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ColorSchema = z.string().trim().min(3).max(40).nullable();
const FontSchema = z.string().trim().min(1).max(120).nullable();
const ClassNameSchema = z.string().trim().min(1).max(120).nullable();

const ExtractedDesignSchema = z.object({
  colors: z.object({
    primary: ColorSchema,
    secondary: ColorSchema,
    accent: ColorSchema,
    background: ColorSchema,
    text: ColorSchema,
  }),
  fonts: z.object({
    heading: FontSchema,
    body: FontSchema,
  }),
  layout_density: z.enum(["compact", "medium", "spacious"]),
  visual_tone: z.string().trim().min(1).max(80),
  screenshot_url: z.string().url().nullable(),
  source_pages: z.array(z.string().url()).max(10),
});

const ExtractedCssClassesSchema = z.object({
  container: ClassNameSchema,
  headings: z.object({
    h1: ClassNameSchema,
    h2: ClassNameSchema,
    h3: ClassNameSchema,
  }),
  button: ClassNameSchema,
  card: ClassNameSchema,
});

const BodySchema = z.object({
  extracted_design: ExtractedDesignSchema,
  extracted_css_classes: ExtractedCssClassesSchema,
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({
    roles: ["super_admin", "admin"] as const,
  });
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Site id must be a UUID.",
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Body validation failed.",
          details: { issues: parsed.error.issues },
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const supabase = getServiceRoleClient();
  const upd = await supabase
    .from("sites")
    .update({
      extracted_design: parsed.data.extracted_design,
      extracted_css_classes: parsed.data.extracted_css_classes,
      design_direction_status: "approved",
      updated_at: new Date().toISOString(),
      updated_by: gate.user?.id ?? null,
    })
    .eq("id", params.id)
    .eq("site_mode", "copy_existing")
    .select("id")
    .maybeSingle();

  if (upd.error) {
    logger.error("site.extract.save_failed", {
      site_id: params.id,
      error: upd.error.message,
    });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to save extraction.",
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
  if (!upd.data) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_STATE",
          message:
            "Site not found or not in copy_existing mode. Re-run onboarding to set the mode.",
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 409 },
    );
  }

  revalidatePath(`/admin/sites/${params.id}`);
  revalidatePath(`/admin/sites/${params.id}/setup/extract`);

  return NextResponse.json(
    {
      ok: true,
      data: { site_id: params.id },
      timestamp: new Date().toISOString(),
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
