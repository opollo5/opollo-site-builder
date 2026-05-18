import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { notifyHealthAlert } from "@/lib/platform/service-health/notify";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const FlagSchema = z.object({
  service_name: z.string().min(1),
  issue_type: z.enum(["billing", "auth", "other"]),
  notes: z.string().max(1000).optional(),
});

export async function POST(req: NextRequest) {
  const gate = await requireAdminForApi({ roles: ["super_admin"] });
  if (gate.kind === "deny") return gate.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = FlagSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { service_name, issue_type, notes } = parsed.data;
  const userId = gate.user?.id ?? null;

  try {
    const svc = getServiceRoleClient();

    const { data: event, error } = await svc
      .from("service_health_events")
      .insert({
        service_name,
        event_type: "manual_flag",
        severity: "critical",
        occurrence_count: 1,
        details: { issue_type, notes: notes ?? "" },
        raised_by_user_id: userId,
      })
      .select()
      .single();

    if (error) throw error;

    void notifyHealthAlert(event).catch((err) =>
      logger.warn("service_health.flag_notify_failed", {
        err: err instanceof Error ? err.message : String(err),
      }),
    );

    return NextResponse.json({ ok: true, event });
  } catch (err) {
    logger.error("service_health.admin_flag_error", {
      service: service_name,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
