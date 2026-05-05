import Link from "next/link";

import { ApproveAutoClose } from "@/components/ApproveAutoClose";
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
// (in middleware.ts PUBLIC_PATHS) — the token IS the auth. Server-
// component validates the random 32-byte token via SHA-256 against
// login_challenges.token_hash, flips the challenge from pending →
// approved, and renders one of:
//
//   - "Sign-in approved." with a clear "Return to your original tab"
//     instruction. The original tab's polling shell does the actual
//     session work — this page intentionally does not try to set a
//     session on the device that clicked the email link, because that
//     device may be a phone or a different browser entirely.
//
//   - "Already used." (consumed already by the original tab's
//     complete-login).
//
//   - "Expired" / "Invalid" — typed reasons.
//
// Lost-tab fallback: a "Complete sign-in here" button is offered on
// the approved/already-approved branches. POSTs to /api/auth/approve-
// here, which mints a Supabase magic link the browser follows. This
// is the path used when the original tab is closed.
//
// Single-use: the second visit to the same approval link sees the
// 'consumed' branch.

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

function PageShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <H1>{title}</H1>
          {subtitle && <Lead className="mt-1">{subtitle}</Lead>}
        </div>
        <div className="rounded-lg border bg-background p-6 shadow-sm space-y-4">
          {children}
        </div>
      </div>
    </main>
  );
}

function StartOverLink() {
  return (
    <Link
      href="/login"
      className="inline-block text-sm font-medium underline underline-offset-4"
    >
      Back to sign in
    </Link>
  );
}

export default async function ApprovePage({ searchParams }: PageProps) {
  const state = await resolveState(searchParams.token);

  if (state.kind === "invalid") {
    return (
      <PageShell title="Approval link">
        <Alert variant="destructive">
          This approval link is invalid. Sign in again from your
          original device to receive a fresh email.
        </Alert>
        <StartOverLink />
      </PageShell>
    );
  }
  if (state.kind === "expired") {
    return (
      <PageShell title="Approval link expired">
        <Alert variant="destructive">
          This link expired (15-minute window). Sign in again to
          receive a fresh email.
        </Alert>
        <StartOverLink />
      </PageShell>
    );
  }
  if (state.kind === "consumed") {
    return (
      <PageShell title="Approval link used">
        <Alert>
          This approval link has been used. You can close this tab.
        </Alert>
        <StartOverLink />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Sign-in approved"
      subtitle={
        state.tokenWasJustApproved
          ? "Return to your original tab — it will sign you in automatically within a few seconds."
          : "Sign-in already approved. Return to your original tab, or complete here if that tab is gone."
      }
    >
      <ApproveAutoClose tokenWasJustApproved={state.tokenWasJustApproved} />

      <div className="border-t pt-4">
        <p className="text-sm font-medium">Lost your original tab?</p>
        <p className="text-sm text-muted-foreground mt-1 mb-3">
          Use the button below to finish signing in on this device
          instead.
        </p>
        <ApproveCompleteHere challengeId={state.challengeId} />
      </div>
    </PageShell>
  );
}
