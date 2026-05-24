import { NextResponse } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { getCompanyTheme } from "@/lib/platform/theming";
import { THEME_TOKEN_KEYS, type ThemeOverrides } from "@/lib/platform/theming/types";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// GET /api/admin/theming/[companyId] — fetch current theme overrides.
// PUT /api/admin/theming/[companyId] — upsert overrides. Body: ThemeOverrides.
// DELETE /api/admin/theming/[companyId] — reset to defaults (deletes the row).
//
// All three require super_admin.
// ---------------------------------------------------------------------------

type RouteParams = { params: Promise<{ companyId: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
  const gate = await requireAdminForApi({ roles: ["super_admin"] });
  if (gate.kind === "deny") return gate.response;

  const { companyId } = await params;
  const row = await getCompanyTheme(companyId);
  return NextResponse.json({ ok: true, data: row });
}

export async function PUT(req: Request, { params }: RouteParams) {
  const gate = await requireAdminForApi({ roles: ["super_admin"] });
  if (gate.kind === "deny") return gate.response;

  const { companyId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  // Strip keys not in the allowed set.
  const raw = (body ?? {}) as Record<string, unknown>;
  const overrides: ThemeOverrides = {};
  for (const key of THEME_TOKEN_KEYS) {
    const v = raw[key];
    if (typeof v === "string" && v.trim()) overrides[key] = v.trim();
  }

  const svc = getServiceRoleClient();
  const userId = gate.user?.id ?? null;

  const { error } = await svc.from("platform_company_theme_overrides").upsert(
    {
      company_id: companyId,
      overrides,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    },
    { onConflict: "company_id" },
  );

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  const gate = await requireAdminForApi({ roles: ["super_admin"] });
  if (gate.kind === "deny") return gate.response;

  const { companyId } = await params;
  const svc = getServiceRoleClient();
  const { error } = await svc
    .from("platform_company_theme_overrides")
    .delete()
    .eq("company_id", companyId);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
