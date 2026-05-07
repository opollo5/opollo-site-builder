"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";

import { useSessionExpiry } from "@/lib/hooks/use-session-expiry";

import { SessionExpiryBanner } from "./session-expiry-banner";
import { SessionExpiryModal } from "./session-expiry-modal";

// Spec 14 PR A — single watcher that mounts both the warning modal and
// the final banner. Drop one of these into the admin shell layout.
//
// "Re-authenticate" navigates to /login?returnTo=<current> so the
// existing login flow (Supabase OAuth + magic-link callback) restores
// the operator to their current page. PR C will replace this with a
// dedicated cybersecurity-explainer page for cap-driven re-auths.

export function SessionExpiryWatcher() {
  const router = useRouter();
  const pathname = usePathname();
  const { minutesRemaining, hydrated } = useSessionExpiry();

  const onReauthenticate = useCallback(() => {
    const returnTo = pathname ?? "/admin";
    router.push(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }, [router, pathname]);

  return (
    <>
      <SessionExpiryBanner
        minutesRemaining={minutesRemaining}
        hydrated={hydrated}
        onReauthenticate={onReauthenticate}
      />
      <SessionExpiryModal
        minutesRemaining={minutesRemaining}
        hydrated={hydrated}
        onReauthenticate={onReauthenticate}
      />
    </>
  );
}
