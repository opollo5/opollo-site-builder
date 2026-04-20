import { NextResponse } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// GET /api/admin/users/list — M2d-1.
//
// Returns every row in opollo_users ordered by created_at desc. Admin-
// only under FEATURE_SUPABASE_AUTH=true (see requireAdminForApi for
// the flag-off / kill-switch bypass rationale).
//
// The query uses the service-role client so RLS doesn't hide rows from
// the caller — the requireAdminForApi check above is the access gate,
// not the row-level policies. Same pattern as every other admin API
// route in the codebase.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
// GET-with-no-request-arg otherwise tempts Next's static optimisation.
// Force-dynamic: the route reads cookies (via the SSR client) and hits
// opollo_users per call, neither of which makes sense to prerender.
export const dynamic = "force-dynamic";

export type AdminUserRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: "admin" | "operator" | "viewer";
  created_at: string;
  revoked_at: string | null;
};

export async function GET(): Promise<NextResponse> {
  const gate = await requireAdminForApi();
  if (gate.kind === "deny") return gate.response;

  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("opollo_users")
    .select("id, email, display_name, role, created_at, revoked_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: `Failed to read opollo_users: ${error.message}`,
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: { users: (data ?? []) as AdminUserRow[] },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
