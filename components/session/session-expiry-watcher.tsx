"use client";

import { createBrowserClient } from "@supabase/ssr";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import { useSessionGrace } from "@/lib/hooks/use-session-grace";

import { SessionExpiryBanner } from "./session-expiry-banner";
import { SessionExpiryModal } from "./session-expiry-modal";

// Spec 14 PR A + PR B — single watcher that mounts both the warning
// modal and the final banner, plus enforces the 48h hard-logout (with
// PR B's 15-minute non-renewable activity grace).
//
// Drop one of these into the admin shell layout.
//
// "Re-authenticate" navigates to /login?returnTo=<current> so the
// existing login flow restores the operator to their current page.
// PR C will replace this with a dedicated cybersecurity-explainer page
// for cap-driven re-auths (vs user-initiated sign-outs).
//
// PR B note: at status === 'logout-now' we call supabase.auth.signOut()
// to invalidate the session server-side, then redirect. The signOut +
// redirect happens once per status flip, guarded by a ref so a re-render
// can't fire it twice.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function SessionExpiryWatcher() {
  const router = useRouter();
  const pathname = usePathname();
  const grace = useSessionGrace();
  const loggedOutRef = useRef(false);

  const onReauthenticate = useCallback(() => {
    const returnTo = pathname ?? "/admin";
    router.push(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }, [router, pathname]);

  // Hard-logout enforcement. Fires exactly once when mustLogout flips
  // true. Server-side signOut + redirect to login. PR C will route
  // cap-driven logouts to a dedicated explainer page; for now /login
  // catches both flows.
  useEffect(() => {
    if (!grace.mustLogout) return;
    if (loggedOutRef.current) return;
    loggedOutRef.current = true;
    void (async () => {
      try {
        if (supabaseUrl && supabaseAnonKey) {
          const supa = createBrowserClient(supabaseUrl, supabaseAnonKey);
          await supa.auth.signOut();
        }
      } catch {
        // Server-side invalidation failure is non-blocking — the JWT is
        // already expired by definition, and the redirect below kicks
        // the user to a re-auth surface.
      }
      const returnTo = pathname ?? "/admin";
      // Use replace() so back-button doesn't return to the expired session.
      // PR C — cap-driven logouts land on /auth/expired (the cybersecurity
      // explainer). User-initiated sign-out continues to land on /login
      // directly; the explainer is only for "we kicked you out" flows.
      window.location.replace(
        `/auth/expired?returnTo=${encodeURIComponent(returnTo)}`,
      );
    })();
  }, [grace.mustLogout, pathname]);

  return (
    <>
      <SessionExpiryBanner
        minutesRemaining={grace.minutesRemaining}
        hydrated={grace.hydrated}
        graceMinutesRemaining={grace.graceMinutesRemaining}
        status={grace.status}
        onReauthenticate={onReauthenticate}
      />
      <SessionExpiryModal
        minutesRemaining={grace.minutesRemaining}
        hydrated={grace.hydrated}
        onReauthenticate={onReauthenticate}
      />
    </>
  );
}
