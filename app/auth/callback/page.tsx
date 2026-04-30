import { AuthCallbackClient } from "@/components/AuthCallbackClient";

// ---------------------------------------------------------------------------
// /auth/callback — client-side auth-link landing page.
//
// Companion to the server-side /api/auth/callback route. Supabase
// emits three different email-link shapes depending on the project's
// auth-flow configuration; only two of them carry their token in the
// URL query string (server-readable). The third — implicit flow —
// tucks the access/refresh token into the URL fragment, which the
// browser never sends to the server. /api/auth/callback can't see
// it, redirects to /auth-error?reason=missing_code, and the recovery
// link is dead-on-arrival.
//
// This page is a thin server-component shell that reads the Supabase
// URL + anon key from env (server-only) and hands them to the client
// component which does the actual hash parsing, setSession, and
// redirect. Keeping the anon key server-only matches the existing
// pattern in lib/supabase.ts — no new NEXT_PUBLIC_* env vars needed.
//
// Public path in middleware (lib/middleware.ts PUBLIC_PATHS) so a
// signed-out browser can land here from an email link.
//
// force-dynamic because the env values can change between deploys
// (rotated anon key, new Supabase project URL).
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is not set.`);
  }
  return value;
}

export default function AuthCallbackPage() {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const supabaseAnonKey = requireEnv("SUPABASE_ANON_KEY");
  return (
    <AuthCallbackClient
      supabaseUrl={supabaseUrl}
      supabaseAnonKey={supabaseAnonKey}
    />
  );
}
