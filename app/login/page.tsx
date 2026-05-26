import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/LoginForm";
import { TAuthChrome } from "@/templates";
import { PENDING_2FA_COOKIE } from "@/lib/2fa/cookies";
import { is2faEnabled } from "@/lib/2fa/flag";
import { createRouteAuthClient, getCurrentUser } from "@/lib/auth";
import { isAuthKillSwitchOn } from "@/lib/auth-kill-switch";

// ---------------------------------------------------------------------------
// /login
//
// Email + password sign-in form. Magic-link / invite flows reuse
// /api/auth/callback and land here only if the operator manually types
// the URL — the already-signed-in short-circuit keeps that painless.
//
// Marked force-dynamic because the page reads per-request cookies via
// createRouteAuthClient to short-circuit for signed-in users. A static
// cache would serve the form to everyone regardless of session state.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

function isSupabaseAuthOn(): boolean {
  const v = process.env.FEATURE_SUPABASE_AUTH;
  return v === "true" || v === "1";
}

function safeNext(raw: string | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) {
    return "/admin/sites";
  }
  return raw;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const next = safeNext(searchParams.next);

  // Recovery path: arriving at /login with a stale opollo_2fa_pending
  // cookie means the user was mid-2FA, then either expired the
  // challenge, navigated away, or had their /complete-login fail.
  // Without an explicit reset they get stuck — the existing session is
  // still valid, the page short-circuits to /admin/sites, middleware
  // sees the pending cookie and bounces back to /login/check-email,
  // and the loop never terminates. /logout clears both the Supabase
  // session and the 2FA cookies and redirects back here, so a clean
  // form is shown on the next request.
  // Only redirect to /logout when 2FA is enabled. When the flag is off,
  // the server action and middleware clear any stale cookie — redirecting
  // to /logout here would wipe the Supabase session that signInWithPassword
  // just set (the RSC re-render runs in the same server-side request context
  // as the action, so cookies().has() reads the incoming cookie, not the
  // cleared outgoing one). See tests/regressions/login-rsc-rerender-logout.test.ts.
  if (is2faEnabled() && cookies().has(PENDING_2FA_COOKIE)) {
    redirect("/logout");
  }

  if (isSupabaseAuthOn()) {
    let killSwitch = false;
    try {
      killSwitch = await isAuthKillSwitchOn();
    } catch {
      killSwitch = false;
    }
    if (!killSwitch) {
      const supabase = createRouteAuthClient();
      const user = await getCurrentUser(supabase);
      if (user) redirect(next);
    }
  }

  return (
    <TAuthChrome title="Opollo Site Builder" subtitle="Sign in to continue.">
      <div className="rounded-lg border bg-background p-6 shadow-sm">
        <LoginForm next={next} />
      </div>
    </TAuthChrome>
  );
}
