import { ApproveCompleteHere } from "@/components/ApproveCompleteHere";
import { Alert } from "@/components/ui/alert";
import { H1, Lead } from "@/components/ui/typography";
import {
  approveChallenge,
  lookupChallengeByToken,
} from "@/lib/2fa/challenges";

// AUTH-FOUNDATION P4.3 — /auth/approve.
//
// The URL the "Approve sign-in" button in the email points at. Public
// (no auth gate) — the token IS the auth. Server-component validates
// the token + flips the challenge to approved, then renders one of:
//
//   - "Sign-in approved. Return to your original tab to continue,
//     or click below to complete sign-in here."
//     With a "Complete sign-in here" button (the lost-tab fallback)
//     that POSTs to /api/auth/approve-here, which signs the user in
//     ON THIS DEVICE via a Supabase magic link.
//
//   - "This approval link has been used." (consumed already by the
//     original tab's complete-login)
//
//   - "This link expired / is invalid" (typed reasons)
//
// Single-use: the second visit to the same approval link sees the
// 'consumed' state.

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: { token?: string };
}

type RenderState =
  | { kind: "approved"; challengeId: string; tokenWasJustApproved: boolean }
  | { kind: "consumed" }
  | { kind: "expired" }
  | { kind: "invalid" };

async function resolveState(rawToken: string | undefined): Promise<RenderState> {
  if (!rawToken || rawToken.length < 32) return { kind: "invalid" };
  const challenge = await lookupChallengeByToken(rawToken);
  if (!challenge) return { kind: "invalid" };

  if (challenge.status === "consumed") return { kind: "consumed" };
  if (challenge.status === "expired") return { kind: "expired" };
  if (new Date(challenge.expires_at).getTime() <= Date.now()) {
    return { kind: "expired" };
  }
  if (challenge.status === "approved") {
    return {
      kind: "approved",
      challengeId: challenge.id,
      tokenWasJustApproved: false,
    };
  }

  // Pending → flip to approved.
  const approveResult = await approveChallenge(challenge.id);
  if (!approveResult.ok) {
    if (approveResult.reason === "already_consumed") return { kind: "consumed" };
    if (approveResult.reason === "expired") return { kind: "expired" };
    if (approveResult.reason === "already_approved") {
      return {
        kind: "approved",
        challengeId: challenge.id,
        tokenWasJustApproved: false,
      };
    }
    return { kind: "invalid" };
  }
  return {
    kind: "approved",
    challengeId: challenge.id,
    tokenWasJustApproved: true,
  };
}

export default async function ApprovePage({ searchParams }: PageProps) {
  const state = await resolveState(searchParams.token);

  if (state.kind === "invalid") {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <H1>Approval link</H1>
        <Alert variant="destructive">
          This approval link is invalid. Sign in again from your original
          device or ask for a fresh attempt.
        </Alert>
      </div>
    );
  }
  if (state.kind === "expired") {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <H1>Approval link expired</H1>
        <Alert variant="destructive">
          This approval link expired (15-minute window). Sign in again
          from your original device to receive a fresh email.
        </Alert>
      </div>
    );
  }
  if (state.kind === "consumed") {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <H1>Approval link used</H1>
        <Alert>
          This approval link has been used. If you&apos;re already
          signed in on the original device you can close this tab.
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <H1>Sign-in approved</H1>
      <Lead className="mt-1">
        {state.tokenWasJustApproved
          ? "Return to your original tab — it'll finish signing you in automatically."
          : "Already approved. If your original tab is gone, complete sign-in here."}
      </Lead>

      <ApproveCompleteHere challengeId={state.challengeId} />
    </div>
  );
}
