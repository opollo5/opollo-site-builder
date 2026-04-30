import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CheckEmailPolling } from "@/components/CheckEmailPolling";
import { Alert } from "@/components/ui/alert";
import { H1, Lead } from "@/components/ui/typography";
import { lookupChallengeById } from "@/lib/2fa/challenges";
import {
  PENDING_2FA_COOKIE,
  decodePending2faCookie,
} from "@/lib/2fa/cookies";
import { createRouteAuthClient } from "@/lib/auth";
import { getServiceRoleClient } from "@/lib/supabase";

// AUTH-FOUNDATION P4.2 — /login/check-email.
//
// Lands here from the login server action after it issues an
// approval challenge. Reads the opollo_2fa_pending cookie + the
// signed-in user's email, renders a polling shell that watches for
// the challenge to flip pending → approved. On approval, the client
// posts to /api/auth/complete-login with the trust-device checkbox
// state.
//
// Public-ish page: requires the 2fa_pending cookie + a valid Supabase
// session. Without either, redirect back to /login.

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: { challenge_id?: string; next?: string; email_send_failed?: string };
}

export default async function CheckEmailPage({ searchParams }: PageProps) {
  const cookieJar = cookies();
  const cookieValue = cookieJar.get(PENDING_2FA_COOKIE)?.value;
  const cookieChallengeId = decodePending2faCookie(cookieValue);

  // No cookie means no pending state — bounce to /login.
  if (!cookieChallengeId) {
    redirect("/login");
  }

  // Confirm the user has a (half-authenticated) Supabase session;
  // without it the cookie is stale and we should reset.
  const supabase = createRouteAuthClient();
  const userRes = await supabase.auth.getUser();
  if (userRes.error || !userRes.data.user) {
    redirect("/login");
  }

  const challenge = await lookupChallengeById(cookieChallengeId);
  if (!challenge) {
    redirect("/login");
  }

  // Pull the user's email for the "We sent an approval link to {email}" line.
  const svc = getServiceRoleClient();
  const userEmailRes = await svc
    .from("opollo_users")
    .select("email")
    .eq("id", challenge.user_id)
    .maybeSingle();
  const userEmail =
    (userEmailRes.data?.email as string | undefined) ??
    userRes.data.user.email ??
    "your email";

  const emailSendFailed = searchParams.email_send_failed === "1";
  const next = searchParams.next ?? "/admin/sites";

  return (
    <div className="mx-auto max-w-md">
      <H1>Check your email</H1>
      <Lead className="mt-1">
        We sent an approval link to{" "}
        <strong className="text-foreground">{userEmail}</strong>. Click
        the link in the email and this page will sign you in
        automatically.
      </Lead>

      {emailSendFailed && (
        <Alert variant="destructive" className="mt-4">
          Email delivery failed. Use the Resend button below — it
          skips the cooldown.
        </Alert>
      )}

      <div className="mt-6">
        <CheckEmailPolling
          challengeId={challenge.id}
          next={next}
          initialEmailFailed={emailSendFailed}
        />
      </div>
    </div>
  );
}
