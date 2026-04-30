import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { checkAdminAccess } from "@/lib/admin-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { recordChangeLog } from "@/lib/optimiser/change-log";

// PATCH /api/optimiser/clients/[id]/cross-client-consent — Phase 3 Slice 24.
// Toggle the per-client cross_client_learning_consent flag.
//
// Admin-only — flipping this opts the client into BOTH directions of
// the cross-client pattern library (per spec §11.2.2): their causal
// observations contribute to the anonymised pattern table, AND their
// proposals receive cross-client priors. Spec §11.2.4 requires an
// MSA-clause to be signed before the flag is flipped to true; the API
// records the toggle but legal sign-off is enforced operationally,
// not in code.

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
    .select("id, cross_client_learning_consent")
    .eq("id", ctx.params.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Client not found" } },
      { status: 404 },
    );
  }

  const before = Boolean(existing.cross_client_learning_consent);
  if (before === body.enabled) {
    return NextResponse.json({
      ok: true,
      data: {
        client_id: ctx.params.id,
        cross_client_learning_consent: body.enabled,
        changed: false,
      },
    });
  }

  const { error: updErr } = await supabase
    .from("opt_clients")
    .update({
      cross_client_learning_consent: body.enabled,
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
    event: "cross_client_learning_consent_toggled",
    actorUserId: access.user?.id ?? null,
    details: { before, after: body.enabled },
  });

  return NextResponse.json({
    ok: true,
    data: {
      client_id: ctx.params.id,
      cross_client_learning_consent: body.enabled,
      changed: true,
    },
  });
}
