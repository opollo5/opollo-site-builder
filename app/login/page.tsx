import { redirect } from "next/navigation";

import { LoginForm } from "@/components/LoginForm";
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
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-xl font-semibold">Opollo Site Builder</h1>
        <p className="text-sm text-muted-foreground">Sign in to continue.</p>
      </div>
      <LoginForm next={next} />
    </main>
  );
}
