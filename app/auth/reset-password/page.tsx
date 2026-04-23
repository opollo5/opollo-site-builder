import { ResetPasswordForm } from "@/components/ResetPasswordForm";
import { createRouteAuthClient, getCurrentUser } from "@/lib/auth";

// ---------------------------------------------------------------------------
// /auth/reset-password — M14-3.
//
// Landing page after the email link → /api/auth/callback PKCE exchange.
// A successful exchange sets a session cookie and redirects the
// browser here. This page checks for the session; if present, it
// renders the password form; otherwise it renders the "expired link"
// state with a "Request a new link" CTA.
//
// force-dynamic because the session check has to run per-request.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const supabase = createRouteAuthClient();
  const user = await getCurrentUser(supabase);

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-6">
        <div className="w-full text-center">
          <h1 className="text-xl font-semibold">Reset link expired</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This reset link has expired or was already used. Request a new link
            to continue.
          </p>
        </div>
        <a
          href="/auth/forgot-password"
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Request a new link
        </a>
        <a
          href="/login"
          className="text-xs text-muted-foreground underline hover:no-underline"
        >
          Back to sign in
        </a>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-6">
      <div className="w-full text-center">
        <h1 className="text-xl font-semibold">Set a new password</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Choose a strong password. Minimum 12 characters.
        </p>
      </div>
      <ResetPasswordForm userEmail={user.email} />
    </main>
  );
}
