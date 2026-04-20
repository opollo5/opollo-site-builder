import { NextResponse } from "next/server";
import { z } from "zod";

import { createRouteAuthClient } from "@/lib/auth";

// ---------------------------------------------------------------------------
// POST /api/auth/login
//
// Thin wrapper around supabase.auth.signInWithPassword that runs through
// the SSR route client — signInWithPassword's setAll callback writes the
// session cookies onto the response via next/headers, so the browser
// gets Set-Cookie for the refresh + access tokens on the 200.
//
// The client then hard-navigates to `next` so the first request to the
// admin surface carries the fresh cookie. Soft-navigating (router.push)
// would re-use the same fetch context and the /admin page would see no
// session.
//
// Public path: middleware allowlists anything under /api/auth/* so this
// is reachable without a session. That is the only safe way to log in.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";

const LoginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
  next: z.string().optional(),
});

function safeNext(raw: string | undefined): string {
  // Open-redirect guard: only same-origin relative paths survive. Any
  // absolute URL, protocol-relative URL, or malformed value falls back
  // to the admin landing. Mirrors the policy in /api/auth/callback.
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) {
    return "/admin/sites";
  }
  return raw;
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Email and password are required.",
          details: { issues: parsed.error.issues },
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const { email, password, next } = parsed.data;
  const supabase = createRouteAuthClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Deliberately identical message for "bad email" vs "bad password"
    // so the response is not an account-enumeration oracle.
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Invalid email or password.",
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 401 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: { next: safeNext(next) },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
