import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const gate = await requireAdminForApi({ roles: ["super_admin"] });
  if (gate.kind === "deny") return gate.response;

  const { id } = params;

  try {
    const svc = getServiceRoleClient();

    const { data: existing, error: fetchError } = await svc
      .from("service_health_events")
      .select("id, resolved_at")
      .eq("id", id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!existing) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    if (existing.resolved_at) {
      return NextResponse.json({ error: "Already resolved" }, { status: 409 });
    }

    const { error: updateError } = await svc
      .from("service_health_events")
      .update({ resolved_at: new Date().toISOString() })
      .eq("id", id);

    if (updateError) throw updateError;

    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("service_health.admin_resolve_error", {
      id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
