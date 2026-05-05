import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { readJsonBody } from "@/lib/http";
import { logger } from "@/lib/logger";
import { isOpolloStaff } from "@/lib/platform/auth";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getActiveBrandProfile, updateBrandProfile } from "@/lib/platform/brand";

// ---------------------------------------------------------------------------
// /api/platform/brand — P-Brand-1b
//
// GET  ?company_id=<uuid> → active brand profile (or null)
// PATCH ?company_id=<uuid> body: { fields: BrandProfilePatch, change_summary?: string }
//        → updated profile (or initial profile created if none existed)
//
// Auth gate:
//   - GET / PATCH both require `edit_company_settings` (admin role on the
//     company, OR Opollo staff). Brand profile is configuration that
//     drives every product's output — admin-level discipline.
//
// Special case: content_restrictions
//   - Per the platform-brand-governance skill: only Opollo staff may
//     modify content_restrictions. Company admins cannot self-modify.
//   - Enforced at this route boundary (not the lib) so the lib stays
//     a single trust layer for tests + scripts to call.
//
// Errors:
//   400 VALIDATION_FAILED — bad body / query shape, malformed UUID
//   401 UNAUTHORIZED      — no session
//   403 FORBIDDEN         — not admin / not opollo staff
//   403 STAFF_ONLY_FIELD  — content_restrictions submitted by a non-staff actor
//   500 INTERNAL_ERROR    — DB failure
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  fields: z
    .object({
      primary_colour: z.string().nullable().optional(),
      secondary_colour: z.string().nullable().optional(),
      accent_colour: z.string().nullable().optional(),
      logo_primary_url: z.string().nullable().optional(),
      logo_dark_url: z.string().nullable().optional(),
      logo_light_url: z.string().nullable().optional(),
      logo_icon_url: z.string().nullable().optional(),
      heading_font: z.string().nullable().optional(),
      body_font: z.string().nullable().optional(),
      image_style: z.record(z.string(), z.unknown()).optional(),
      approved_style_ids: z.array(z.string()).optional(),
      safe_mode: z.boolean().optional(),
      personality_traits: z.array(z.string()).optional(),
      formality: z.enum(["formal", "semi_formal", "casual"]).nullable().optional(),
      point_of_view: z.enum(["first_person", "third_person"]).nullable().optional(),
      preferred_vocabulary: z.array(z.string()).optional(),
      avoided_terms: z.array(z.string()).optional(),
      voice_examples: z.array(z.string()).optional(),
      focus_topics: z.array(z.string()).optional(),
      avoided_topics: z.array(z.string()).optional(),
      industry: z.string().nullable().optional(),
      default_approval_required: z.boolean().optional(),
      default_approval_rule: z.enum(["any_one", "all_must"]).nullable().optional(),
      platform_overrides: z.record(z.string(), z.unknown()).optional(),
      hashtag_strategy: z.enum(["none", "minimal", "standard", "heavy"]).nullable().optional(),
      max_post_length: z.enum(["short", "medium", "long"]).nullable().optional(),
      content_restrictions: z.array(z.string()).optional(),
    })
    .strict(),
  change_summary: z.string().min(1).max(500).nullable().optional(),
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

function parseCompanyId(req: NextRequest): string | null {
  const id = new URL(req.url).searchParams.get("company_id");
  if (!id) return null;
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuid.test(id) ? id : null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const companyId = parseCompanyId(req);
  if (!companyId) {
    return errorJson(
      "VALIDATION_FAILED",
      "company_id query param must be a UUID.",
      400,
    );
  }

  const gate = await requireCanDoForApi(companyId, "edit_company_settings");
  if (gate.kind === "deny") return gate.response;

  const brand = await getActiveBrandProfile(companyId);
  return NextResponse.json(
    {
      ok: true,
      data: { brand },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const companyId = parseCompanyId(req);
  if (!companyId) {
    return errorJson(
      "VALIDATION_FAILED",
      "company_id query param must be a UUID.",
      400,
    );
  }

  const body = await readJsonBody(req);
  if (body === undefined) return errorJson("VALIDATION_FAILED", "Request body must be valid JSON.", 400);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message:
            "Body must be { fields: BrandProfilePatch, change_summary?: string }.",
          details: { issues: parsed.error.issues },
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const gate = await requireCanDoForApi(companyId, "edit_company_settings");
  if (gate.kind === "deny") return gate.response;

  // Special-case: content_restrictions is staff-only. Per the
  // platform-brand-governance skill, only Opollo staff may modify this
  // field; company admins must request a change. We enforce at the
  // route boundary so the lib + scripts stay trust-uniform.
  if (parsed.data.fields.content_restrictions !== undefined) {
    const staff = await isOpolloStaff(gate.supabase);
    if (!staff) {
      return errorJson(
        "STAFF_ONLY_FIELD",
        "content_restrictions can only be modified by Opollo staff. Contact support to request a change.",
        403,
      );
    }
  }

  const result = await updateBrandProfile({
    companyId,
    updatedBy: gate.userId,
    changeSummary: parsed.data.change_summary ?? null,
    fields: parsed.data.fields,
  });

  if (!result.ok) {
    const status = result.error.code === "VALIDATION_FAILED" ? 400 : 500;
    return errorJson(result.error.code, result.error.message, status);
  }

  logger.info("platform.brand.update.ok", {
    company_id: companyId,
    updated_by: gate.userId,
    created: result.created,
    new_version: result.brand.version,
  });

  return NextResponse.json(
    {
      ok: true,
      data: {
        brand: result.brand,
        created: result.created,
      },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
