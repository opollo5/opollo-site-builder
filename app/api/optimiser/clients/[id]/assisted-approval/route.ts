import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { checkAdminAccess } from "@/lib/admin-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { recordChangeLog } from "@/lib/optimiser/change-log";

// PATCH /api/optimiser/clients/[id]/assisted-approval — Slice 21.
// Toggle the per-client assisted_approval_enabled flag.
//
// Admin-only — flipping the flag changes the default approval posture
// for an entire client's proposal stream. Operators can read, only
// admins can write. High-risk proposals always require manual approval
// regardless of this setting; the auto-approval cron enforces that
// at the proposal level (defence in depth).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  enabled: z.boolean(),
});

export async function PATCH(
  req: NextRequest,
  ctx: { params: { id: string } },
): Promise<NextResponse> {
  const access = await checkAdminAccess({ requiredRoles: ["admin"] });
  if (access.kind === "redirect") {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "UNAUTHORIZED", message: "Admin access required" },
      },
      { status: 401 },
    );
  }
  let body;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_BODY",
          message: err instanceof Error ? err.message : "Invalid body",
        },
      },
      { status: 400 },
    );
  }

  const supabase = getServiceRoleClient();
  const { data: existing } = await supabase
    .from("opt_clients")
    .select("id, assisted_approval_enabled")
    .eq("id", ctx.params.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Client not found" } },
      { status: 404 },
    );
  }

  const before = Boolean(existing.assisted_approval_enabled);
  if (before === body.enabled) {
    return NextResponse.json({
      ok: true,
      data: { client_id: ctx.params.id, assisted_approval_enabled: body.enabled, changed: false },
    });
  }

  const { error: updErr } = await supabase
    .from("opt_clients")
    .update({
      assisted_approval_enabled: body.enabled,
      updated_at: new Date().toISOString(),
      updated_by: access.user?.id ?? null,
    })
    .eq("id", ctx.params.id);
  if (updErr) {
    return NextResponse.json(
      { ok: false, error: { code: "UPDATE_FAILED", message: updErr.message } },
      { status: 500 },
    );
  }

  await recordChangeLog({
    clientId: ctx.params.id,
    event: "assisted_approval_toggled",
    actorUserId: access.user?.id ?? null,
    details: { before, after: body.enabled },
  });

  return NextResponse.json({
    ok: true,
    data: {
      client_id: ctx.params.id,
      assisted_approval_enabled: body.enabled,
      changed: true,
    },
  });
}
