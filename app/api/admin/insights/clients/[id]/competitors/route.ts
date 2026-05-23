import { NextResponse } from "next/server";

import { requireCapOperatorForApi } from "@/lib/cap/api-gate";
import { AuditFailedError, writeAdminAudit } from "@/lib/insights/admin-audit";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

const SUPPORTED_PLATFORMS = ["LINKEDIN", "FACEBOOK"] as const;
type Platform = (typeof SUPPORTED_PLATFORMS)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireCapOperatorForApi();
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ ok: false, error: { code: "INVALID_COMPANY_ID" } }, { status: 400 });
  }

  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("ins_competitor_accounts")
    .select("id, platform, competitor_handle, competitor_display_name, created_at")
    .eq("company_id", params.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("ins.admin.competitors.list_failed", { companyId: params.id, error: error.message });
    return NextResponse.json({ ok: false, error: { code: "DB_ERROR" } }, { status: 500 });
  }

  return NextResponse.json({ ok: true, competitors: data ?? [] });
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireCapOperatorForApi();
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ ok: false, error: { code: "INVALID_COMPANY_ID" } }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const platform = body.platform as string;
  const handle = typeof body.handle === "string" ? body.handle.trim().toLowerCase() : "";
  const displayName = typeof body.display_name === "string" ? body.display_name.trim().slice(0, 255) : null;

  if (!SUPPORTED_PLATFORMS.includes(platform as Platform)) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_PLATFORM", message: "platform must be LINKEDIN or FACEBOOK" } },
      { status: 400 },
    );
  }

  if (!handle || handle.length > 100) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_HANDLE", message: "handle is required and must be ≤100 chars" } },
      { status: 400 },
    );
  }

  const svc = getServiceRoleClient();

  try {
    await writeAdminAudit(
      {
        operatorUserId: gate.userId,
        clientCompanyId: params.id,
        action: "add_competitor",
        actionDetails: { platform, handle, displayName },
        clientIp: req.headers.get("x-forwarded-for") ?? undefined,
        userAgent: req.headers.get("user-agent") ?? undefined,
      },
      true,
    );
  } catch (err) {
    if (err instanceof AuditFailedError) {
      return NextResponse.json(
        { ok: false, error: { code: "AUDIT_WRITE_FAILED", message: "Action blocked: audit log unavailable", retryable: true } },
        { status: 503 },
      );
    }
    throw err;
  }

  const { data, error } = await svc
    .from("ins_competitor_accounts")
    .insert({
      company_id: params.id,
      platform,
      competitor_handle: handle,
      competitor_display_name: displayName,
    })
    .select("id, platform, competitor_handle, competitor_display_name, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { ok: false, error: { code: "DUPLICATE", message: "Competitor already tracked for this platform" } },
        { status: 409 },
      );
    }
    logger.error("ins.admin.competitors.add_failed", { companyId: params.id, error: error.message });
    return NextResponse.json({ ok: false, error: { code: "DB_ERROR" } }, { status: 500 });
  }

  return NextResponse.json({ ok: true, competitor: data }, { status: 201 });
}
