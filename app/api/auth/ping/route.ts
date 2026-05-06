import { NextResponse } from "next/server";

import { createRouteAuthClient } from "@/lib/auth";

// ---------------------------------------------------------------------------
// GET /api/auth/ping — lightweight session-extend endpoint.
//
// Middleware refreshes the Supabase session on every authenticated request.
// Calling this endpoint from the client is sufficient to extend the session
// without navigating away. The response carries the new `expires_at` so the
// client can reset its expiry timer.
//
// No auth gate — the middleware handles auth; unauthenticated calls simply
// return `{ ok: true, expires_at: null }`.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const supabase = createRouteAuthClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return NextResponse.json(
    {
      ok: true,
      expires_at: session?.expires_at ?? null,
    },
    { status: 200 },
  );
}
