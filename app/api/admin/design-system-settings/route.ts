import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Zod schema for a CSS hex colour — #rgb or #rrggbb or #rrggbbaa
const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{3,8}$/, "Must be a hex colour (#rgb or #rrggbb)")
  .nullable()
  .optional();

// Zod schema for a CSS length — px, rem, em, or % value
const cssLength = z
  .string()
  .regex(
    /^[0-9]+(\.[0-9]+)?(px|rem|em|%)$/,
    "Must be a CSS length (e.g. 1rem, 16px, 50%)",
  )
  .nullable()
  .optional();

const SettingsSchema = z.object({
  color_pk:      hexColor,
  color_pk2:     hexColor,
  color_gr:      hexColor,
  color_gr2:     hexColor,
  color_bl:      hexColor,
  color_am:      hexColor,
  color_rd:      hexColor,
  color_bg:      hexColor,
  color_d1:      hexColor,
  color_d2:      hexColor,
  color_d3:      hexColor,
  color_d4:      hexColor,
  font_size_base: cssLength,
  font_size_xl:   cssLength,
  font_display:   z.string().max(200).nullable().optional(),
  font_body:      z.string().max(200).nullable().optional(),
  radius_lg:      cssLength,
  radius_full:    cssLength,
});

type Settings = z.infer<typeof SettingsSchema>;

function deny(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

// GET /api/admin/design-system-settings
// Returns the global (company_id IS NULL) row, or null if none exists.
export async function GET(): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin"] });
  if (gate.kind === "deny") return gate.response;

  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("design_system_settings")
    .select("*")
    .is("company_id", null)
    .maybeSingle();

  if (error) {
    logger.error("design_system_settings GET failed", { error: error.message });
    return deny("DB_ERROR", "Failed to load settings.", 500);
  }

  return NextResponse.json({ ok: true, settings: data });
}

// PUT /api/admin/design-system-settings
// Upserts the global settings row.
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin"] });
  if (gate.kind === "deny") return gate.response;

  let parsed: Settings;
  try {
    const json = await req.json();
    parsed = SettingsSchema.parse(json);
  } catch (err) {
    return deny(
      "VALIDATION_FAILED",
      err instanceof Error ? err.message : "Invalid request body.",
      400,
    );
  }

  const sb = getServiceRoleClient();

  // Check for existing row.
  const { data: existing, error: fetchErr } = await sb
    .from("design_system_settings")
    .select("id")
    .is("company_id", null)
    .maybeSingle();

  if (fetchErr) {
    logger.error("design_system_settings fetch-for-upsert failed", { error: fetchErr.message });
    return deny("DB_ERROR", "Failed to load settings.", 500);
  }

  const payload = {
    ...parsed,
    company_id: null,
    updated_at: new Date().toISOString(),
    updated_by: gate.user?.id ?? null,
  };

  if (existing) {
    const { error: updateErr } = await sb
      .from("design_system_settings")
      .update(payload)
      .eq("id", existing.id);

    if (updateErr) {
      logger.error("design_system_settings update failed", { error: updateErr.message });
      return deny("DB_ERROR", "Failed to save settings.", 500);
    }
  } else {
    const { error: insertErr } = await sb
      .from("design_system_settings")
      .insert({ ...payload, created_by: gate.user?.id ?? null });

    if (insertErr) {
      logger.error("design_system_settings insert failed", { error: insertErr.message });
      return deny("DB_ERROR", "Failed to save settings.", 500);
    }
  }

  return NextResponse.json({ ok: true });
}
