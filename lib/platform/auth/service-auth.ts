import "server-only";

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createRouteAuthClient } from "@/lib/auth";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Spec v1.0 §2.2 — service-role API authentication for machine actors.
//
// Two accepted auth paths:
//   1. x-platform-service-key header — for CAP and other machine actors.
//      Must also supply x-platform-actor-id (CAP's stable identifier).
//   2. Supabase auth session (cookie) — for human users (unchanged path).
//
// PLATFORM_SERVICE_API_KEY must be set in the target environment.
// Generate: openssl rand -base64 32
// ---------------------------------------------------------------------------

export type ServiceAuthResult =
  | { kind: "service"; actorId: string }
  | { kind: "user"; userId: string; supabase: SupabaseClient }
  | { kind: "deny"; response: NextResponse };

function deny(code: string, message: string, status: 401 | 403): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code, message, retryable: false }, timestamp: new Date().toISOString() },
    { status },
  );
}

/**
 * Authenticate a platform API request: service key OR user session.
 * Use in place of requireCanDoForApi for routes that accept machine actors.
 */
export async function authenticateRequest(req: Request): Promise<ServiceAuthResult> {
  const apiKey = req.headers.get("x-platform-service-key");

  if (apiKey !== null) {
    const expected = process.env.PLATFORM_SERVICE_API_KEY;
    if (!expected || apiKey !== expected) {
      return { kind: "deny", response: deny("UNAUTHORIZED", "Invalid service API key.", 401) };
    }
    const actorId = req.headers.get("x-platform-actor-id");
    if (!actorId) {
      return {
        kind: "deny",
        response: deny("UNAUTHORIZED", "Service-key requests must set x-platform-actor-id.", 401),
      };
    }
    return { kind: "service", actorId };
  }

  const supabase = createRouteAuthClient();
  const { data: userResp, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResp?.user) {
    return { kind: "deny", response: deny("UNAUTHORIZED", "Authentication required.", 401) };
  }
  return { kind: "user", userId: userResp.user.id, supabase };
}

/**
 * Gate for service actors: company must have cap_weekly_enabled = true.
 * Returns ok = true when the actor is permitted to act on this company.
 */
export async function validateServiceActorCompany(
  companyId: string,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const svc = getServiceRoleClient();
  const { data } = await svc
    .from("platform_companies")
    .select("cap_weekly_enabled")
    .eq("id", companyId)
    .maybeSingle();

  if (!data?.cap_weekly_enabled) {
    return {
      ok: false,
      response: deny("FORBIDDEN", "Service actors may only act on companies with cap_weekly_enabled.", 403),
    };
  }
  return { ok: true };
}

/**
 * Record a service_action_taken event in platform_events (fire-and-forget).
 * The actorId is stored in payload.service_actor_id because platform_events.actor_id
 * is a FK to platform_users — machine actors are not platform_users rows.
 */
export function recordServiceAction(
  companyId: string,
  actorId: string,
  payload?: Record<string, unknown>,
): void {
  const svc = getServiceRoleClient();
  void svc.from("platform_events").insert({
    company_id: companyId,
    event_type: "service_action_taken",
    payload: { service_actor_id: actorId, ...payload },
  });
}
