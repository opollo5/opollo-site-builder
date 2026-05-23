import { NextResponse } from "next/server";

import { requireCapOperatorForApi } from "@/lib/cap/api-gate";
import { AuditFailedError, writeAdminAudit } from "@/lib/insights/admin-audit";

export async function POST(
  req: Request,
  { params }: { params: { id: string; recId: string } },
) {
  const gate = await requireCapOperatorForApi();
  if (gate.kind === "deny") return gate.response;

  const body = await req.json().catch(() => ({}));
  const note = typeof body.note === "string" ? body.note.slice(0, 1000) : null;

  try {
    await writeAdminAudit(
      {
        operatorUserId: gate.userId,
        clientCompanyId: params.id,
        action: "annotate",
        actionDetails: {
          recommendationId: params.recId,
          note,
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

  return NextResponse.json({ ok: true });
}
