import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";
import { H1, Lead } from "@/components/ui/typography";

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
    <main className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <H1>Forgot your password?</H1>
          <Lead className="mt-2">
            Enter your email and we&apos;ll send you a reset link.
          </Lead>
        </div>
        <div className="rounded-lg border bg-background p-6 shadow-sm">
          <ForgotPasswordForm />
        </div>
        <p className="text-center text-xs text-muted-foreground">
          <a
            href="/login"
            className="underline transition-smooth hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
          >
            Back to sign in
          </a>
        </p>
      </div>
    </main>
  );
}
