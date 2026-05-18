import "server-only";

import { NextResponse } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireAdminForApi({ roles: ["super_admin"] });
  if (gate.kind === "deny") return gate.response;

  try {
    const svc = getServiceRoleClient();
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await svc
      .from("service_health_events")
      .select("*")
      .gte("last_seen_at", since)
      .order("last_seen_at", { ascending: false })
      .limit(500);

    if (error) throw error;

    return NextResponse.json({ events: data ?? [] });
  } catch (err) {
    logger.error("service_health.admin_events_get_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
