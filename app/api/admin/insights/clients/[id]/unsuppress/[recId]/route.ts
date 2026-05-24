import { NextResponse } from "next/server";

import { requireCapOperatorForApi } from "@/lib/cap/api-gate";
import { AuditFailedError, writeAdminAudit } from "@/lib/insights/admin-audit";
import { getServiceRoleClient } from "@/lib/supabase";

export async function POST(
  req: Request,
  { params }: { params: { id: string; recId: string } },
) {
  const gate = await requireCapOperatorForApi();
  if (gate.kind === "deny") return gate.response;

  const body = await req.json().catch(() => ({}));

  try {
    await writeAdminAudit(
      {
        operatorUserId: gate.userId,
        clientCompanyId: params.id,
        action: "unsuppress",
        actionDetails: {
          recommendationId: params.recId,
          reason: body.reason ?? null,
        },
        clientIp: req.headers.get("x-forwarded-for") ?? undefined,
        userAgent: req.headers.get("user-agent") ?? undefined,
      },
      true,
    );
  } catch (err) {
    if (err instanceof AuditFailedError) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "AUDIT_WRITE_FAILED",
            message: "Action blocked: audit log unavailable",
            retryable: true,
          },
        },
        { status: 503 },
      );
    }
    throw err;
  }

  const svc = getServiceRoleClient();
  await svc
    .from("ins_recommendations")
    .update({ suppressed: false })
    .eq("id", params.recId)
    .eq("company_id", params.id);

  return NextResponse.json({ ok: true });
}
