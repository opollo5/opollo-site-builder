import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { internalError, validationError } from "@/lib/http";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{3,8}$/, "Must be a hex colour (#rgb or #rrggbb)")
  .nullable()
  .optional();

const cssLength = z
  .string()
  .regex(
    /^[0-9]+(\.[0-9]+)?(px|rem|em|%)$/,
    "Must be a CSS length (e.g. 1rem, 16px, 50%)",
  )
  .nullable()
  .optional();

const SettingsSchema = z.object({
  color_pk:       hexColor,
  color_pk2:      hexColor,
  color_gr:       hexColor,
  color_gr2:      hexColor,
  color_bl:       hexColor,
  color_am:       hexColor,
  color_rd:       hexColor,
  color_bg:       hexColor,
  color_d1:       hexColor,
  color_d2:       hexColor,
  color_d3:       hexColor,
  color_d4:       hexColor,
  font_size_base: cssLength,
  font_size_xl:   cssLength,
  font_display:   z.string().max(200).nullable().optional(),
  font_body:      z.string().max(200).nullable().optional(),
  radius_lg:      cssLength,
  radius_full:    cssLength,
});

type Settings = z.infer<typeof SettingsSchema>;

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
    return internalError("Failed to load settings.");
  }

  return NextResponse.json({ ok: true, settings: data });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin"] });
  if (gate.kind === "deny") return gate.response;

  let parsed: Settings;
  try {
    const json = await req.json();
    parsed = SettingsSchema.parse(json);
  } catch (err) {
    return validationError(err instanceof Error ? err.message : "Invalid request body.");
  }

  const sb = getServiceRoleClient();

  const { data: existing, error: fetchErr } = await sb
    .from("design_system_settings")
    .select("id")
    .is("company_id", null)
    .maybeSingle();

  if (fetchErr) {
    logger.error("design_system_settings fetch-for-upsert failed", { error: fetchErr.message });
    return internalError("Failed to load settings.");
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
      return internalError("Failed to save settings.");
    }
  } else {
    const { error: insertErr } = await sb
      .from("design_system_settings")
      .insert({ ...payload, created_by: gate.user?.id ?? null });

    if (insertErr) {
      logger.error("design_system_settings insert failed", { error: insertErr.message });
      return internalError("Failed to save settings.");
    }
  }

  return NextResponse.json({ ok: true });
}
