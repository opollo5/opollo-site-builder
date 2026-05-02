import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { buildAuthRedirectUrl } from "@/lib/auth-redirect";
import { logger } from "@/lib/logger";
import {
  checkRateLimit,
  getClientIp,
  rateLimitExceeded,
} from "@/lib/rate-limit";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/admin/users/invite — M2d-3.
//
// Admin-only. Creates an invite for `email` via Supabase Auth's admin
// generateLink (type: 'invite') and returns the action URL. Using
// generateLink rather than inviteUserByEmail means:
//
//   - The call is deterministic in tests — no SMTP configuration
//     required for the request to succeed.
//   - Prod ops can copy-paste the action_link to the invitee if email
//     delivery is broken or the invite expires.
//   - When SMTP is configured on the Supabase project, the same link
//     is also delivered by email (generateLink triggers the standard
//     invite template when `options.redirectTo` is passed and the
//     project has mail enabled).
//
// Side effects: the call creates an auth.users row (email_confirmed_at
// still null). The handle_new_auth_user trigger from migration 0004
// fires immediately and inserts the matching opollo_users row with
// role='user', so the invitee shows up in /admin/users as pending
// before they click the link. After acceptance, the callback exchanges
// the code for a session and lands them on `next` (default `/`).
//
// Errors:
//   400 VALIDATION_FAILED   — bad email / missing body.
//   401 UNAUTHORIZED        — flag on + no session.
//   403 FORBIDDEN           — non-admin caller.
//   409 ALREADY_EXISTS      — the email already maps to an auth user.
//                             Demote/revoke / reinvite separately;
//                             magic-link re-send is a separate route.
//   500 INTERNAL_ERROR      — everything else (Supabase admin API
//                             failure, DB failure).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const InviteSchema = z.object({
  email: z.string().email().max(254),
  next: z.string().optional(),
});

function safeNext(raw: string | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

function errorJson(
  code: string,
  message: string,
  status: number,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: false, ...(extra ?? {}) },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const rlId = gate.user ? `user:${gate.user.id}` : `ip:${getClientIp(req)}`;
  const rl = await checkRateLimit("invite", rlId);
  if (!rl.ok) return rateLimitExceeded(rl);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = InviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Body must be { email: string; next?: string }.",
          details: { issues: parsed.error.issues },
          retryable: false, // VALIDATION_FAILED is not retryable — same input loops forever (M15-4 #5)
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const email = parsed.data.email.trim().toLowerCase();
  const next = safeNext(parsed.data.next);

  // Build the redirect target through the canonical auth-redirect helper
  // (M14-2). In production this resolves to NEXT_PUBLIC_SITE_URL if set,
  // falling back to the incoming request origin. That combination covers
  // local dev (no env, uses localhost origin), Vercel preview (no env,
  // uses the preview hostname), and Vercel production (pinned via env,
  // immune to Host-header spoofing). Supabase tacks `?code=<uuid>` (PKCE)
  // or `#access_token=...` (implicit flow) onto redirect_to when the
  // invitee clicks the link; the client-side /auth/callback page
  // dispatches both — implicit-flow fragments are handled directly
  // (setSession), query-string shapes are forwarded to
  // /api/auth/callback for the cookie-bearing exchange.
  //
  // The URL must also appear in the Supabase dashboard's Redirect URLs
  // allowlist or Supabase rejects it — see docs/RUNBOOK.md
  // "Supabase Auth URL configuration".
  const redirectTo = buildAuthRedirectUrl(
    `/auth/callback?next=${encodeURIComponent(next)}`,
    req,
  );

  const svc = getServiceRoleClient();

  const { data, error } = await svc.auth.admin.generateLink({
    type: "invite",
    email,
    options: { redirectTo },
  });

  if (error) {
    // Supabase returns 422 for "User already registered" (email
    // collision). Translate that to a dedicated 409 so the UI can
    // distinguish a duplicate invite from any other failure.
    const status = (error as { status?: number }).status;
    if (
      status === 422 ||
      /already (registered|exists)/i.test(error.message)
    ) {
      return errorJson(
        "ALREADY_EXISTS",
        "A user with that email already exists. Promote or revoke them from the users list instead.",
        409,
      );
    }
    logger.error("admin.users.invite.generate_failed", { error });
    return errorJson(
      "INTERNAL_ERROR",
      "Failed to generate invite. Please try again or contact support with the request id from the response headers.",
      500,
    );
  }

  const actionLink = data?.properties?.action_link ?? null;
  const userId = data?.user?.id ?? null;

  return NextResponse.json(
    {
      ok: true,
      data: {
        email,
        user_id: userId,
        action_link: actionLink,
      },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
