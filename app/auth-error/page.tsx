import Link from "next/link";

import { TErrorState } from "@/templates";

// ---------------------------------------------------------------------------
// /auth-error
//
// Static fallback page the middleware (and /api/auth/callback) redirect
// to when the Supabase Auth path fails closed under FEATURE_SUPABASE_AUTH.
// Kept deliberately minimal: no client JS, no data fetches, renders
// without any session — it's the "the auth system itself is broken"
// destination, so it must not depend on the auth system.
//
// `reason` is an informational query param only. We don't translate it
// to prose because the precise failure mode can be unhelpful to a
// logged-out user; operator triage uses server logs.
// ---------------------------------------------------------------------------

export const dynamic = "force-static";

export default function AuthErrorPage() {
  return (
    <TErrorState
      title="Authentication error"
      body="We couldn't verify your session. Try signing in again — if this keeps happening, contact an operator."
      cta={
        <Link
          href="/login"
          className="text-sm font-medium underline underline-offset-4"
        >
          Back to sign in
        </Link>
      }
    />
  );
}
