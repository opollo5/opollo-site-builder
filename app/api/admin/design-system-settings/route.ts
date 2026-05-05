import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminForApi } from "@/lib/admin-api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{3,8}$/, "Must be a valid hex colour")
  .nullable()
  .optional();

const PutSchema = z.object({
  color_pk:     hexColor,
  color_pk2:    hexColor,
  color_gr:     hexColor,
  color_gr2:    hexColor,
  color_bl:     hexColor,
  color_am:     hexColor,
  color_rd:     hexColor,
  color_d1:     hexColor,
  color_d2:     hexColor,
  color_d3:     hexColor,
  color_d4:     hexColor,
  color_bg:     hexColor,
  font_display: z.string().nullable().optional(),
  font_body:    z.string().nullable().optional(),
  radius:       z.string().nullable().optional(),
});

export async function GET(_req: NextRequest) {
  const gate = await requireAdminForApi({ roles: ["super_admin"] });
  if (gate.kind === "deny") return gate.response;

  try {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("design_system_settings")
      .select("*")
      .is("company_id", null)
      .maybeSingle();
    if (error) {
      logger.error("design-system-settings GET failed", { error: error.message });
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
    return NextResponse.json({ settings: data ?? null });
  } catch (err) {
    logger.error("design-system-settings GET threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const gate = await requireAdminForApi({ roles: ["super_admin"] });
  if (gate.kind === "deny") return gate.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const payload = { ...parsed.data, company_id: null, updated_at: new Date().toISOString() };

  try {
    const supabase = getServiceRoleClient();
    const { error } = await supabase
      .from("design_system_settings")
      .upsert(payload, { onConflict: "company_id" });
    if (error) {
      logger.error("design-system-settings PUT failed", { error: error.message });
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("design-system-settings PUT threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
