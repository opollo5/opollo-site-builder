import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";
import { H1, Lead } from "@/components/ui/typography";

// ---------------------------------------------------------------------------
// /auth/forgot-password — M14-3.
//
// Simple static-ish page: form → POST /api/auth/forgot-password →
// confirmation copy. No session gating — anyone (signed in or not)
// can request a reset link for any email. The API route is where
// rate limiting + no-enumeration semantics live.
// ---------------------------------------------------------------------------

export const dynamic = "force-static";

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-6">
      <div className="w-full text-center">
        <H1>Forgot your password?</H1>
        <Lead className="mt-2">
          Enter your email and we&apos;ll send you a reset link.
        </Lead>
      </div>
      <ForgotPasswordForm />
      <div className="text-center text-xs text-muted-foreground">
        <a
          href="/login"
          className="underline transition-smooth hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
        >
          Back to sign in
        </a>
      </div>
    </main>
  );
}
