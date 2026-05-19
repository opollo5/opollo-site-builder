import Link from "next/link";

import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";
import { TAuthChrome } from "@/templates";

// ---------------------------------------------------------------------------
// /auth/forgot-password — M14-3.
//
// Simple static-ish page: form → POST /api/auth/forgot-password →
// confirmation copy. No session gating — anyone (signed in or not)
// can request a reset link for any email. The API route is where
// rate limiting + no-enumeration semantics live.
//
// R1-10 — page wrapped in `bg-canvas` (matches admin shell) and the
// form sits in a card so the inputs/buttons read against a
// background, not floating on raw white.
// ---------------------------------------------------------------------------

export const dynamic = "force-static";

export default function ForgotPasswordPage() {
  return (
    <TAuthChrome
      title="Forgot your password?"
      subtitle="Enter your email and we'll send you a reset link."
      footer={
        <Link
          href="/login"
          className="underline transition-smooth hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
        >
          Back to sign in
        </Link>
      }
    >
      <div className="rounded-lg border bg-background p-6 shadow-sm">
        <ForgotPasswordForm />
      </div>
    </TAuthChrome>
  );
}
