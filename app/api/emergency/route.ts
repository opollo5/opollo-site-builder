import { NextResponse } from "next/server";
import { z } from "zod";

import { revokeUserSessions } from "@/lib/auth-revoke";
import { constantTimeEqual } from "@/lib/crypto-compare";
import { readJsonBody } from "@/lib/http";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/emergency — M2c-3 break-glass operator surface.
//
// Purpose: recover the app when Supabase Auth (GoTrue) is down or mis-
// configured. This is the ONLY route that is reachable without a
// Supabase session AND can mutate opollo_config.auth_kill_switch —
// which in turn tells middleware to fall back to Basic Auth.
//
// Authentication: static pre-shared key via OPOLLO_EMERGENCY_KEY env
// var. Header format (either accepted):
//
//   X-Opollo-Emergency-Key: <key>
//   Authorization: Bearer <key>
//
// Why pre-shared key and not Supabase: the whole reason this route
// exists is that Supabase Auth might be broken. Anything that depends
// on it for access control can't be the emergency hatch.
//
// Why 503 when unset: "key not configured" is a deployment state, not
// a credential problem. A 401 here would be misleading — it would say
// "your creds are wrong" when the reality is the server refuses to
// accept ANY key.
//
// Actions:
//
//   kill_switch_on
//     Upserts opollo_config.auth_kill_switch = 'on'. Middleware then
//     routes every request through basicAuthGate. Propagation up to 5s
//     per serverless instance (see lib/auth-kill-switch.ts cache).
//
//   kill_switch_off
//     Deletes the opollo_config row. Middleware resumes the Supabase
//     Auth path on the next cache refresh.
//
//   revoke_user { user_id }
//     Hard revocation — opollo_users.revoked_at = now() and session +
//     refresh tokens swept. See lib/auth-revoke.ts revokeUserSessions.
//     Immediate effect on the next getCurrentUser call.
//
// Logging: structured console output. A dedicated opollo_audit_events
// table is future work (M7 fleet infra) — for v1 the Vercel log
// viewer is the audit trail, plus anyone with the emergency key is
// already trusted root-level.
//
// Runtime: nodejs. revokeUserSessions imports pg (Node-only) and
// middleware bypasses /api/emergency anyway, so no Edge concerns.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";

const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("kill_switch_on") }),
  z.object({ action: z.literal("kill_switch_off") }),
  z.object({
    action: z.literal("revoke_user"),
    user_id: z.string().uuid(),
  }),
]);

// Minimum length for the emergency key. Short keys are brute-force
// targets and the route is reachable without Supabase — any
// misconfiguration that sets e.g. "changeme" would be catastrophic.
const MIN_KEY_LENGTH = 32;

function extractKey(req: Request): string | null {
  const custom = req.headers.get("x-opollo-emergency-key");
  if (custom) return custom.trim();
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ")) {
    return bearer.slice(7).trim();
  }
  return null;
}

type EmergencyLog = {
  ok: boolean;
  action?: string;
  user_id?: string;
  reason?: string;
  error?: string;
};

function logEmergencyEvent(event: EmergencyLog): void {
  // eslint-disable-next-line no-console
  console.error(
    "[emergency]",
    JSON.stringify({ ts: new Date().toISOString(), ...event }),
  );
}

function jsonError(
  code: string,
  message: string,
  status: number,
  retryable = false,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

export async function POST(req: Request): Promise<NextResponse> {
  const expected = process.env.OPOLLO_EMERGENCY_KEY;
  if (!expected || expected.length < MIN_KEY_LENGTH) {
    logEmergencyEvent({ ok: false, reason: "not_configured" });
    return jsonError(
      "EMERGENCY_NOT_CONFIGURED",
      "Emergency access is not configured on this deployment.",
      503,
    );
  }

  const provided = extractKey(req);
  if (!provided || !constantTimeEqual(provided, expected)) {
    logEmergencyEvent({ ok: false, reason: "auth_failed" });
    return jsonError(
      "UNAUTHORIZED",
      "Invalid emergency key.",
      401,
    );
  }

  const body = await readJsonBody(req);
  if (body === undefined) return jsonError("VALIDATION_FAILED", "Request body must be valid JSON.", 400);
  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Invalid emergency action payload.",
          details: { issues: parsed.error.issues },
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const svc = getServiceRoleClient();
  const action = parsed.data.action;

  try {
    if (action === "kill_switch_on") {
      const { error } = await svc
        .from("opollo_config")
        .upsert(
          { key: "auth_kill_switch", value: "on" },
          { onConflict: "key" },
        );
      if (error) throw new Error(error.message);
      logEmergencyEvent({ ok: true, action });
      return NextResponse.json(
        {
          ok: true,
          data: {
            action,
            note: "Middleware will fall back to Basic Auth. Propagation up to 5s per serverless instance.",
          },
          timestamp: new Date().toISOString(),
        },
        { status: 200 },
      );
    }

    if (action === "kill_switch_off") {
      const { error } = await svc
        .from("opollo_config")
        .delete()
        .eq("key", "auth_kill_switch");
      if (error) throw new Error(error.message);
      logEmergencyEvent({ ok: true, action });
      return NextResponse.json(
        {
          ok: true,
          data: {
            action,
            note: "Middleware will resume the Supabase Auth path. Propagation up to 5s per serverless instance.",
          },
          timestamp: new Date().toISOString(),
        },
        { status: 200 },
      );
    }

    // action === "revoke_user"
    await revokeUserSessions(parsed.data.user_id);
    logEmergencyEvent({
      ok: true,
      action,
      user_id: parsed.data.user_id,
    });
    return NextResponse.json(
      {
        ok: true,
        data: {
          action,
          user_id: parsed.data.user_id,
          note: "revoked_at stamped and sessions swept. The next getCurrentUser call rejects the user's prior JWT.",
        },
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEmergencyEvent({ ok: false, action, error: message });
    return jsonError(
      "INTERNAL_ERROR",
      "Emergency action failed. See server logs.",
      500,
      true,
    );
  }
}
