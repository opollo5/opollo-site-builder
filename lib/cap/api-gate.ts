import "server-only";

import { NextResponse } from "next/server";

import { createRouteAuthClient } from "@/lib/auth";

export type CapApiGateResult =
  | { kind: "allow"; userId: string }
  | { kind: "deny"; response: NextResponse };

function denyResponse(code: string, message: string, status: 401 | 403): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code, message, retryable: false }, timestamp: new Date().toISOString() },
    { status },
  );
}

export async function requireCapOperatorForApi(): Promise<CapApiGateResult> {
  const supabase = createRouteAuthClient();
  const { data: userResp, error: userErr } = await supabase.auth.getUser();

  if (userErr || !userResp?.user) {
    return { kind: "deny", response: denyResponse("UNAUTHORIZED", "Authentication required.", 401) };
  }

  const { data: isOp, error: rpErr } = await supabase.rpc("is_cap_operator");
  if (rpErr || isOp !== true) {
    return { kind: "deny", response: denyResponse("FORBIDDEN", "CAP operator access required.", 403) };
  }

  return { kind: "allow", userId: userResp.user.id };
}
