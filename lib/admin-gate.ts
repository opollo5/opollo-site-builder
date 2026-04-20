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
//   FEATURE_SUPABASE_AUTH on + wrong role   → redirect (default /).
//                                             Admin surface is ops-level
//                                             (site management, DS
//                                             edits); viewers belong on
//                                             the chat builder.
//
//   FEATURE_SUPABASE_AUTH on + allowed role → allow, with the user
//                                             threaded through so the
//                                             layout can render the
//                                             email + sign-out.
//
// M2d-1 extended the helper with `opts.requiredRoles` and
// `opts.insufficientRoleRedirectTo` so admin-only pages (e.g.
// /admin/users) can narrow the allowed role set and send mismatched
// roles somewhere more useful than the top-level `/` — typically
// back to /admin/sites.
// ---------------------------------------------------------------------------

export const ADMIN_ROLES: readonly Role[] = ["admin", "operator"];

export type AdminAccessOptions = {
  /** Which roles are allowed. Defaults to ADMIN_ROLES (admin + operator). */
  requiredRoles?: readonly Role[];
  /**
   * Where to redirect users whose role is not in `requiredRoles`. Defaults
   * to "/" (the chat builder). Admin-only pages nested inside the admin
   * surface typically pass "/admin/sites" so an operator who lands on a
   * /admin/users link is sent to a page they can actually use.
   */
  insufficientRoleRedirectTo?: string;
};

export type AdminAccessResult =
  | { kind: "allow"; user: SessionUser | null }
  | { kind: "redirect"; to: string };

function isSupabaseAuthOn(): boolean {
  const v = process.env.FEATURE_SUPABASE_AUTH;
  return v === "true" || v === "1";
}

export async function checkAdminAccess(
  opts: AdminAccessOptions = {},
): Promise<AdminAccessResult> {
  const requiredRoles = opts.requiredRoles ?? ADMIN_ROLES;
  const insufficientRedirect = opts.insufficientRoleRedirectTo ?? "/";

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
  if (!requiredRoles.includes(user.role)) {
    return { kind: "redirect", to: insufficientRedirect };
  }
  return { kind: "allow", user };
}
