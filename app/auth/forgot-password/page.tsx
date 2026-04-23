import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";

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
        <h1 className="text-xl font-semibold">Forgot your password?</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter your email and we&apos;ll send you a reset link.
        </p>
      </div>
      <ForgotPasswordForm />
      <div className="text-center text-xs text-muted-foreground">
        <a href="/login" className="underline hover:no-underline">
          Back to sign in
        </a>
      </div>
    </main>
  );
}
