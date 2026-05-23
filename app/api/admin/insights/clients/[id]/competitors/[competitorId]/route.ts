import { NextResponse } from "next/server";

import { requireCapOperatorForApi } from "@/lib/cap/api-gate";
import { AuditFailedError, writeAdminAudit } from "@/lib/insights/admin-audit";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  req: Request,
  { params }: { params: { id: string; competitorId: string } },
) {
  const gate = await requireCapOperatorForApi();
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id) || !UUID_RE.test(params.competitorId)) {
    return NextResponse.json({ ok: false, error: { code: "INVALID_ID" } }, { status: 400 });
  }

  const svc = getServiceRoleClient();

  // Fetch the competitor to confirm ownership before audit/delete
  const { data: existing } = await svc
    .from("ins_competitor_accounts")
    .select("id, company_id, platform, competitor_handle")
    .eq("id", params.competitorId)
    .eq("company_id", params.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ ok: false, error: { code: "NOT_FOUND" } }, { status: 404 });
  }

  try {
    await writeAdminAudit(
      {
        operatorUserId: gate.userId,
        clientCompanyId: params.id,
        action: "remove_competitor",
        actionDetails: {
          competitorId: params.competitorId,
          platform: existing.platform,
          handle: existing.competitor_handle,
        },
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

  const { error } = await svc
    .from("ins_competitor_accounts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", params.competitorId)
    .eq("company_id", params.id);

  if (error) {
    logger.error("ins.admin.competitors.delete_failed", {
      companyId: params.id,
      competitorId: params.competitorId,
      error: error.message,
    });
    return NextResponse.json({ ok: false, error: { code: "DB_ERROR" } }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
