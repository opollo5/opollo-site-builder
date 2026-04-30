"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useEffect, useRef, useState } from "react";

import { Lead } from "@/components/ui/typography";
import { planAuthCallback } from "@/lib/auth-callback";

// ---------------------------------------------------------------------------
// AuthCallbackClient — browser-side handler for /auth/callback.
//
// Three Supabase email-link shapes land here, depending on which auth
// flow the project is configured for:
//
//   1. PKCE         → ?code=<uuid>            (handled by /api/auth/callback)
//   2. OTP          → ?token_hash=&type=...   (handled by /api/auth/callback)
//   3. Implicit     → #access_token=...&refresh_token=...&type=...  (HERE)
//
// The implicit flow stores tokens in the URL fragment, which never
// reaches the server, so the existing /api/auth/callback route
// (server-only) sees an empty query string and 302s to /auth-error.
// This client page picks up where that breaks: it parses the fragment,
// calls supabase.auth.setSession to mint cookies, and then redirects
// to the right surface based on the recovery-link `type`.
//
// For the two server-handled shapes, the client delegates by hard-
// redirecting to /api/auth/callback with the original query string
// intact — that keeps PKCE / OTP exchanges in the same place
// historically and avoids reimplementing them client-side.
//
// The decision logic itself lives in lib/auth-callback.ts as the pure
// `planAuthCallback` function so it can be unit-tested without a
// browser environment.
// ---------------------------------------------------------------------------

type Props = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

export function AuthCallbackClient({ supabaseUrl, supabaseAnonKey }: Props) {
  // useEffect runs twice in dev StrictMode. setSession is idempotent
  // for the same tokens, but the redirect is not — guard so a second
  // invocation doesn't race the first navigation.
  const handledRef = useRef(false);
  const [status, setStatus] = useState<"signing_in" | "redirecting">(
    "signing_in",
  );

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const plan = planAuthCallback(window.location.href);

    if (plan.kind === "auth_error") {
      setStatus("redirecting");
      const reason = encodeURIComponent(plan.reason);
      window.location.replace(`/auth-error?reason=${reason}`);
      return;
    }

    if (plan.kind === "forward_to_api") {
      setStatus("redirecting");
      window.location.replace(plan.target);
      return;
    }

    // plan.kind === "set_session"
    const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
    supabase.auth
      .setSession({
        access_token: plan.access_token,
        refresh_token: plan.refresh_token,
      })
      .then(({ error }) => {
        setStatus("redirecting");
        if (error) {
          window.location.replace("/auth-error?reason=set_session_failed");
          return;
        }
        window.location.replace(plan.destination);
      })
      .catch(() => {
        setStatus("redirecting");
        window.location.replace("/auth-error?reason=set_session_failed");
      });
  }, [supabaseUrl, supabaseAnonKey]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="text-center">
        <Lead>{status === "signing_in" ? "Signing you in…" : "Redirecting…"}</Lead>
      </div>
    </main>
  );
}
