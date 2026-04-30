import { createHash } from "node:crypto";

import { AcceptInviteForm } from "@/components/AcceptInviteForm";
import { Alert } from "@/components/ui/alert";
import { H1, Lead } from "@/components/ui/typography";
import { getServiceRoleClient } from "@/lib/supabase";

// AUTH-FOUNDATION P3.2 — /auth/accept-invite.
//
// Public route (no auth gate — the token IS the auth). Server-component
// validates the token by hashing it and checking invites for a
// matching pending+unexpired row. The shape returned to the client
// form is intentionally narrow: we send the invite's email (so the
// page can show "Setting password for foo@example.com" — a reassurance
// that the right person is on the link) but NOT the role or invite_id.
// The POST /api/auth/accept-invite endpoint re-validates server-side
// before creating the user.

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: { token?: string };
}

interface ValidatedInvite {
  email: string;
  expires_at: string;
}

async function validateToken(
  rawToken: string,
): Promise<
  | { kind: "ok"; invite: ValidatedInvite }
  | { kind: "err"; reason: "missing" | "invalid" | "expired" | "consumed" }
> {
  if (!rawToken || rawToken.length < 32) {
    return { kind: "err", reason: "missing" };
  }
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("invites")
    .select("email, status, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error || !data) {
    return { kind: "err", reason: "invalid" };
  }
  const row = data as { email: string; status: string; expires_at: string };
  if (row.status === "accepted") {
    return { kind: "err", reason: "consumed" };
  }
  if (row.status === "revoked") {
    return { kind: "err", reason: "invalid" };
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { kind: "err", reason: "expired" };
  }
  return {
    kind: "ok",
    invite: { email: row.email, expires_at: row.expires_at },
  };
}

export default async function AcceptInvitePage({ searchParams }: PageProps) {
  const rawToken = searchParams.token ?? "";
  const result = await validateToken(rawToken);

  if (result.kind === "err") {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <H1>Invite link</H1>
        <Alert variant="destructive">
          {result.reason === "missing" && "No invite token provided."}
          {result.reason === "invalid" &&
            "This invite link is invalid. Ask your admin for a fresh invite."}
          {result.reason === "expired" &&
            "This invite has expired. Ask your admin for a fresh invite."}
          {result.reason === "consumed" &&
            "This invite has already been accepted. Sign in normally."}
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <H1>Set your password</H1>
      <Lead className="mt-1">
        Setting up Opollo Site Builder for{" "}
        <strong className="text-foreground">{result.invite.email}</strong>.
      </Lead>
      <div className="mt-6">
        <AcceptInviteForm token={rawToken} email={result.invite.email} />
      </div>
    </div>
  );
}
