import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createRouteAuthClient } from "@/lib/auth";

import { canDo } from "./index";
import type { PermissionAction } from "./types";

// Route-level gate for platform-customer endpoints. Mirrors the shape of
// lib/admin-api-gate.ts (the operator-side gate against opollo_users role)
// but evaluates against the platform layer: auth.users session → canDo
// against platform_company_users role for `companyId` (or Opollo-staff
// override).
//
// Returns the cookie-bound SupabaseClient on allow so the route handler
// can reuse it for follow-up RPC / queries against RLS-scoped reads. The
// authenticated user's id is also returned for audit columns (invited_by,
// revoked_by, etc.).

export type PlatformApiGateResult =
  | { kind: "allow"; userId: string; supabase: SupabaseClient }
  | { kind: "deny"; response: NextResponse };

function denyResponse(
  code: string,
  message: string,
  status: 401 | 403,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: false },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

export async function requireCanDoForApi(
  companyId: string,
  action: PermissionAction,
): Promise<PlatformApiGateResult> {
  const supabase = createRouteAuthClient();
  const { data: userResp, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResp?.user) {
    return {
      kind: "deny",
      response: denyResponse(
        "UNAUTHORIZED",
        "Authentication required.",
        401,
      ),
    };
  }

  const allowed = await canDo(companyId, action, supabase);
  if (!allowed) {
    return {
      kind: "deny",
      response: denyResponse(
        "FORBIDDEN",
        `Action '${action}' not permitted in this company.`,
        403,
      ),
    };
  }

  return { kind: "allow", userId: userResp.user.id, supabase };
}
