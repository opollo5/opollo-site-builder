import { NextResponse } from "next/server";

import {
  createRouteAuthClient,
  getCurrentUser,
  type Role,
  type SessionUser,
} from "@/lib/auth";
import { isAuthKillSwitchOn } from "@/lib/auth-kill-switch";

// ---------------------------------------------------------------------------
// M2d-1 — admin-only API route gate.
//
// Mirrors lib/admin-gate.ts (which is for Server Components / layouts)
// but produces a NextResponse on denial instead of a redirect result.
// Route handlers compose it as a single helper call:
//
//   const gate = await requireAdminForApi();
//   if (gate.kind === "deny") return gate.response;
//   // ... handler continues with gate.user available
//
// Same flag/kill-switch logic as the layout gate:
//
//   FEATURE_SUPABASE_AUTH unset/false       → allow (Basic Auth covered
//                                             the edge; route trusts
//                                             the middleware gate and
//                                             proceeds with user: null).
//
//   FEATURE_SUPABASE_AUTH on + kill switch  → allow (break-glass; same
//                                             reasoning — Basic Auth
//                                             took over at the edge).
//
//   FEATURE_SUPABASE_AUTH on + no session   → deny, 401 UNAUTHORIZED.
//
//   FEATURE_SUPABASE_AUTH on + wrong role   → deny, 403 FORBIDDEN.
//
//   FEATURE_SUPABASE_AUTH on + allowed role → allow, user threaded
//                                             through.
//
// The flag-off / kill-switch bypass means admin API routes keep working
// during a Supabase-Auth outage when middleware has fallen back to
// Basic Auth. That's the whole point of the break-glass path — if
// /admin/users/list started returning 401 the moment we kicked the
// switch, we'd have broken the very admin tools needed to fix the
// outage.
// ---------------------------------------------------------------------------

export type ApiGateResult =
  | { kind: "allow"; user: SessionUser | null }
  | { kind: "deny"; response: NextResponse };

function isSupabaseAuthOn(): boolean {
  const v = process.env.FEATURE_SUPABASE_AUTH;
  return v === "true" || v === "1";
}

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

export async function requireAdminForApi(
  opts: { roles?: readonly Role[] } = {},
): Promise<ApiGateResult> {
  const roles = opts.roles ?? (["super_admin", "admin"] as const);

  if (!isSupabaseAuthOn()) return { kind: "allow", user: null };

  let killSwitch = false;
  try {
    killSwitch = await isAuthKillSwitchOn();
  } catch {
    killSwitch = false;
  }
  if (killSwitch) return { kind: "allow", user: null };

  const supabase = createRouteAuthClient();
  const user = await getCurrentUser(supabase);
  if (!user) {
    return {
      kind: "deny",
      response: denyResponse("UNAUTHORIZED", "Authentication required.", 401),
    };
  }
  if (!roles.includes(user.role)) {
    return {
      kind: "deny",
      response: denyResponse(
        "FORBIDDEN",
        `Role '${user.role}' is not permitted for this resource.`,
        403,
      ),
    };
  }
  return { kind: "allow", user };
}
