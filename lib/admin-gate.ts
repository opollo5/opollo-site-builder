import {
  createRouteAuthClient,
  getCurrentUser,
  type Role,
  type SessionUser,
} from "@/lib/auth";
import { isAuthKillSwitchOn } from "@/lib/auth-kill-switch";

// ---------------------------------------------------------------------------
// M2c-2 — admin-layout gate.
//
// Wrapped in a helper so app/admin/layout.tsx stays thin and we can pin
// the behaviour matrix with a unit test instead of stubbing the Next.js
// Server Component runtime.
//
// The decision tree, keyed off the same flags as middleware:
//
//   FEATURE_SUPABASE_AUTH unset/false       → allow. Basic Auth has
//                                             already gated the edge;
//                                             there is no Supabase user
//                                             to reason about.
//
//   FEATURE_SUPABASE_AUTH on + kill switch  → allow. Break-glass to the
//     = "on"                                   legacy Basic Auth path,
//                                             again no Supabase user.
//
//   FEATURE_SUPABASE_AUTH on + no session   → redirect /login. Defence-
//                                             in-depth: middleware also
//                                             catches this, but a
//                                             misconfigured matcher or
//                                             cache refresh edge case
//                                             shouldn't leak /admin.
//
//   FEATURE_SUPABASE_AUTH on + viewer role  → redirect /. The admin
//                                             surface is ops-level (site
//                                             management, DS edits);
//                                             viewers belong on the
//                                             chat builder.
//
//   FEATURE_SUPABASE_AUTH on + admin/op     → allow, with the user
//                                             threaded through so the
//                                             layout can render the
//                                             email + sign-out.
// ---------------------------------------------------------------------------

export const ADMIN_ROLES: readonly Role[] = ["admin", "operator"];

export type AdminAccessResult =
  | { kind: "allow"; user: SessionUser | null }
  | { kind: "redirect"; to: "/login" | "/" };

function isSupabaseAuthOn(): boolean {
  const v = process.env.FEATURE_SUPABASE_AUTH;
  return v === "true" || v === "1";
}

export async function checkAdminAccess(): Promise<AdminAccessResult> {
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
  if (!user) return { kind: "redirect", to: "/login" };
  if (!ADMIN_ROLES.includes(user.role)) return { kind: "redirect", to: "/" };
  return { kind: "allow", user };
}
