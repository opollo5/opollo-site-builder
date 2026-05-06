import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

const OverrideSchema = z.object({
  color_pk:     z.string().regex(HEX_RE).nullish(),
  color_pk2:    z.string().regex(HEX_RE).nullish(),
  color_gr:     z.string().regex(HEX_RE).nullish(),
  color_gr2:    z.string().regex(HEX_RE).nullish(),
  color_bl:     z.string().regex(HEX_RE).nullish(),
  color_am:     z.string().regex(HEX_RE).nullish(),
  color_rd:     z.string().regex(HEX_RE).nullish(),
  color_d1:     z.string().regex(HEX_RE).nullish(),
  color_d2:     z.string().regex(HEX_RE).nullish(),
  color_d3:     z.string().regex(HEX_RE).nullish(),
  color_d4:     z.string().regex(HEX_RE).nullish(),
  color_bg:     z.string().regex(HEX_RE).nullish(),
  font_display: z.string().max(64).nullish(),
  font_body:    z.string().max(64).nullish(),
  radius:       z.string().max(32).nullish(),
});

const SELECT =
  "color_pk,color_pk2,color_gr,color_gr2,color_bl,color_am,color_rd,color_d1,color_d2,color_d3,color_d4,color_bg,font_display,font_body,radius,updated_at";

export async function GET(): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin"] });
  if (gate.kind === "deny") return gate.response;

  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("design_system_settings")
    .select(SELECT)
    .is("company_id", null)
    .maybeSingle();

  if (error) {
    logger.error("design-system-settings GET failed", { error: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? null });
}

export async function PUT(req: Request): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin"] });
  if (gate.kind === "deny") return gate.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = OverrideSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const payload = {
    company_id: null as null,
    ...parsed.data,
    updated_by: gate.user?.id ?? null,
  };

  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("design_system_settings")
    .upsert(payload, { onConflict: "company_id" })
    .select(SELECT)
    .single();

  if (error) {
    logger.error("design-system-settings PUT failed", { error: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
