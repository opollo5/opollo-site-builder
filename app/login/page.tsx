import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/LoginForm";
import { H1, Lead } from "@/components/ui/typography";
import { PENDING_2FA_COOKIE } from "@/lib/2fa/cookies";
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
  if (cookies().has(PENDING_2FA_COOKIE)) {
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
    <main className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <H1>Opollo Site Builder</H1>
          <Lead className="mt-1">Sign in to continue.</Lead>
        </div>
        <div className="rounded-lg border bg-background p-6 shadow-sm">
          <LoginForm next={next} />
        </div>
      </div>
    </main>
  );
}
