import { createHash } from "node:crypto";

import { PlatformAcceptInviteForm } from "@/components/PlatformAcceptInviteForm";
import { Alert } from "@/components/ui/alert";
import { H1, Lead } from "@/components/ui/typography";
import { getServiceRoleClient } from "@/lib/supabase";

// Platform-layer invitation accept page (P2-3 follow-up).
//
// The send flow (POST /api/platform/invitations) emails recipients a link
// to /invite/<raw-token>. This page hashes the path-param token, looks up
// the matching platform_invitations row, validates state (pending +
// unexpired + not revoked), and renders a form that posts the password +
// full name to POST /api/platform/invitations/accept. The accept route
// re-validates server-side; this page is the operator-facing surface.
//
// Distinct from /auth/accept-invite (operator-side P3.2 invites for the
// existing Site Builder admin role band). Different table, different
// minimum password length, different lib.

export const dynamic = "force-dynamic";

interface PageProps {
  params: { token: string };
}

interface ValidatedInvite {
  email: string;
  role: "admin" | "approver" | "editor" | "viewer";
  companyName: string;
}

async function validateToken(
  rawToken: string,
): Promise<
  | { kind: "ok"; invite: ValidatedInvite }
  | { kind: "err"; reason: "missing" | "invalid" | "expired" | "consumed" | "revoked" }
> {
  if (!rawToken || rawToken.length < 32) {
    return { kind: "err", reason: "missing" };
  }
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const supabase = getServiceRoleClient();
  const inviteResult = await supabase
    .from("platform_invitations")
    .select("email, role, status, expires_at, company_id, revoked_at, accepted_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (inviteResult.error || !inviteResult.data) {
    return { kind: "err", reason: "invalid" };
  }
  const row = inviteResult.data as {
    email: string;
    role: ValidatedInvite["role"];
    status: string;
    expires_at: string;
    company_id: string;
    revoked_at: string | null;
    accepted_at: string | null;
  };
  if (row.status === "revoked" || row.revoked_at) {
    return { kind: "err", reason: "revoked" };
  }
  if (row.status === "accepted" || row.accepted_at) {
    return { kind: "err", reason: "consumed" };
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { kind: "err", reason: "expired" };
  }

  // Separate query for the company name. Using an embed here would have
  // to disambiguate which platform_companies FK is being followed, and
  // a follow-up name fetch keeps the lib resilient to FK additions.
  const companyResult = await supabase
    .from("platform_companies")
    .select("name")
    .eq("id", row.company_id)
    .maybeSingle();
  const companyName =
    (companyResult.data as { name: string } | null)?.name ?? "your company";

  return {
    kind: "ok",
    invite: {
      email: row.email,
      role: row.role,
      companyName,
    },
  };
}

export default async function PlatformInviteAcceptPage({ params }: PageProps) {
  const result = await validateToken(params.token);

  if (result.kind === "err") {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <H1>Invitation</H1>
        <Alert variant="destructive">
          {result.reason === "missing" && "No invitation token provided."}
          {result.reason === "invalid" &&
            "This invitation link is invalid. Ask the inviter for a fresh one."}
          {result.reason === "expired" &&
            "This invitation has expired. Ask the inviter for a new one."}
          {result.reason === "consumed" &&
            "This invitation has already been accepted. Sign in instead."}
          {result.reason === "revoked" &&
            "This invitation was revoked. Ask the inviter for a new one."}
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <H1>Join {result.invite.companyName}</H1>
      <Lead className="mt-1">
        Setting up your Opollo account for{" "}
        <strong className="text-foreground">{result.invite.email}</strong> as{" "}
        <strong className="text-foreground">
          {capitaliseRole(result.invite.role)}
        </strong>
        .
      </Lead>
      <div className="mt-6">
        <PlatformAcceptInviteForm
          token={params.token}
          email={result.invite.email}
        />
      </div>
    </div>
  );
}

function capitaliseRole(role: ValidatedInvite["role"]): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
