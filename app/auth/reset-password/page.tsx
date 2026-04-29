import { ResetPasswordForm } from "@/components/ResetPasswordForm";
import { Button } from "@/components/ui/button";
import { H1, Lead } from "@/components/ui/typography";
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
          <H1>Reset link expired</H1>
          <Lead className="mt-2">
            This reset link has expired or was already used. Request a new
            link to continue.
          </Lead>
        </div>
        <Button asChild>
          <a href="/auth/forgot-password">Request a new link</a>
        </Button>
        <a
          href="/login"
          className="text-xs text-muted-foreground underline transition-smooth hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
        >
          Back to sign in
        </a>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-6">
      <div className="w-full text-center">
        <H1>Set a new password</H1>
        <Lead className="mt-2">
          Choose a strong password. Minimum 12 characters.
        </Lead>
      </div>
      <ResetPasswordForm userEmail={user.email} />
    </main>
  );
}
