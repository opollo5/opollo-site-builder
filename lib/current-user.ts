import { createRouteAuthClient, getCurrentUser, type SessionUser } from "@/lib/auth";
import { isAuthKillSwitchOn } from "@/lib/auth-kill-switch";

// ---------------------------------------------------------------------------
// resolveCurrentUser — layout / header helper.
//
// Same flag / kill-switch / getUser walk as lib/admin-gate.ts, but
// returns null on any "no identity available" path instead of driving
// a redirect decision. Intended for non-gated surfaces like the chat
// builder's header strip that want to RENDER the current user when
// one exists and otherwise show nothing.
//
//   FEATURE_SUPABASE_AUTH off        → null. No Supabase user to show;
//                                      Basic Auth doesn't carry one.
//   FEATURE_SUPABASE_AUTH + kill sw  → null. Break-glass Basic Auth
//                                      again — no Supabase identity.
//   Flag on + no session             → null. Middleware would already
//                                      have redirected; null here is
//                                      a defensive fallback.
//   Flag on + valid session          → SessionUser.
// ---------------------------------------------------------------------------

function isSupabaseAuthOn(): boolean {
  const v = process.env.FEATURE_SUPABASE_AUTH;
  return v === "true" || v === "1";
}

export async function resolveCurrentUser(): Promise<SessionUser | null> {
  if (!isSupabaseAuthOn()) return null;

  let killSwitch = false;
  try {
    killSwitch = await isAuthKillSwitchOn();
  } catch {
    killSwitch = false;
  }
  if (killSwitch) return null;

  const supabase = createRouteAuthClient();
  try {
    return await getCurrentUser(supabase);
  } catch {
    return null;
  }
}
