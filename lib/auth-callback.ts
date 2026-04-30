// ---------------------------------------------------------------------------
// auth-callback.ts — pure helpers for the /auth/callback client page.
//
// The client component reads URL state and decides one of four next
// actions: set the session from a hash fragment, forward to the
// server-side /api/auth/callback, surface an error to /auth-error, or
// no-op while the page renders. Splitting that decision out into a
// pure function (planAuthCallback) lets us unit-test the matrix
// without spinning up a browser environment.
// ---------------------------------------------------------------------------

export type AuthCallbackPlan =
  | {
      kind: "set_session";
      access_token: string;
      refresh_token: string;
      // Where to navigate after setSession resolves. Recovery links land
      // on /auth/reset-password; everything else honours `next` (open-
      // redirect-guarded) or falls back to /admin/sites.
      destination: string;
    }
  | {
      kind: "forward_to_api";
      // Path + query string to navigate to (server route handles the
      // exchange). Always starts with `/api/auth/callback`.
      target: string;
    }
  | {
      kind: "auth_error";
      reason: string;
    };

function isSafeNext(rawNext: string | null, origin: string): string {
  // Only allow same-origin relative paths through. Blocks open-redirect
  // attacks that rewrite the link's `?next=` to an external host.
  if (!rawNext) return "/admin/sites";
  if (!rawNext.startsWith("/") || rawNext.startsWith("//")) {
    return "/admin/sites";
  }
  try {
    const u = new URL(rawNext, origin);
    if (u.origin !== origin) return "/admin/sites";
    return u.pathname + u.search;
  } catch {
    return "/admin/sites";
  }
}

/**
 * Plan the next action for the /auth/callback page given the URL the
 * browser landed on. Caller (the client component) is responsible for
 * actually executing the plan — this function is pure.
 *
 * Decision priority:
 *   1. Hash carries error / error_code → AuthError, surface the reason.
 *   2. Hash carries access_token + refresh_token → set the session,
 *      navigate to /auth/reset-password (recovery) or `next` /
 *      /admin/sites otherwise.
 *   3. Query carries `code` or `token_hash` → forward to the server
 *      route which already handles those exchanges.
 *   4. Nothing recognised → AuthError(missing_code).
 */
export function planAuthCallback(href: string): AuthCallbackPlan {
  const url = new URL(href);
  const params = url.searchParams;

  const rawHash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const hashParams = new URLSearchParams(rawHash);

  const next = isSafeNext(params.get("next"), url.origin);

  const hashError =
    hashParams.get("error") ?? hashParams.get("error_code") ?? null;
  if (hashError) {
    return { kind: "auth_error", reason: hashError };
  }

  const accessToken = hashParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token");
  const hashType = hashParams.get("type");
  if (accessToken && refreshToken) {
    const destination =
      hashType === "recovery" ? "/auth/reset-password" : next;
    return {
      kind: "set_session",
      access_token: accessToken,
      refresh_token: refreshToken,
      destination,
    };
  }

  if (params.get("code") || params.get("token_hash")) {
    return {
      kind: "forward_to_api",
      target: `/api/auth/callback${url.search}`,
    };
  }

  return { kind: "auth_error", reason: "missing_code" };
}
