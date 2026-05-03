import { redirect } from "next/navigation";

import { SocialConnectionsList } from "@/components/SocialConnectionsList";
import { H1, Lead } from "@/components/ui/typography";
import { canDo, getCurrentPlatformSession } from "@/lib/platform/auth";
import { listConnections } from "@/lib/platform/social/connections";

// ---------------------------------------------------------------------------
// S1-12 / S1-16 — customer connections roster at /company/social/connections.
//
// Server-rendered. Same gating pattern as the rest of /company:
//   1. No session → /login.
//   2. No company membership → "Not provisioned" envelope.
//
// Read gate: any company member (viewer+ via canDo("view_calendar")).
// Manage gate: admin (canDo("manage_connections")) drives the
// Reconnect button visibility on individual rows.
//
// S1-16 added ?connect=success|error|noop|sync-failed query support so
// the bundle.social hosted-portal callback can land the admin back here
// with a contextual toast.
// ---------------------------------------------------------------------------

type SearchParams = {
  connect?: string;
  reason?: string;
  count?: string;
};

const REASON_LABEL: Record<string, string> = {
  "not-enough-permissions":
    "The connected account didn't grant all the permissions Opollo needs.",
  "not-enough-pages": "No eligible pages were attached to that account.",
  "auth-failed": "The platform rejected the sign-in.",
  "user-cancelled": "You cancelled the connection flow.",
};

function ConnectBanner({ params }: { params: SearchParams }) {
  if (!params.connect) return null;
  if (params.connect === "success") {
    const n = Number(params.count ?? "1");
    return (
      <div
        className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
        role="status"
        data-testid="connect-banner-success"
      >
        Connected {n} new {n === 1 ? "account" : "accounts"}.
      </div>
    );
  }
  if (params.connect === "noop") {
    return (
      <div
        className="mb-4 rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground"
        role="status"
        data-testid="connect-banner-noop"
      >
        No new accounts were attached. If you expected to see one, try
        Refresh — bundle.social may still be finalising.
      </div>
    );
  }
  const detail =
    params.reason && REASON_LABEL[params.reason]
      ? REASON_LABEL[params.reason]
      : "The connection couldn't be completed.";
  return (
    <div
      className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      role="alert"
      data-testid="connect-banner-error"
    >
      {detail} You can try again from the Connect new account button below.
    </div>
  );
}

export const dynamic = "force-dynamic";

export default async function CompanySocialConnectionsPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const session = await getCurrentPlatformSession();
  if (!session) {
    redirect(
      `/login?next=${encodeURIComponent("/company/social/connections")}`,
    );
  }

  if (!session.company) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
        <p className="font-medium">Account not provisioned to a company.</p>
        <p className="mt-1 text-muted-foreground">
          Your account isn&apos;t a member of any company on the platform
          yet. Ask an admin to invite you, or contact Opollo support.
        </p>
      </div>
    );
  }

  const companyId = session.company.companyId;

  const [listResult, canManage, canReconnect] = await Promise.all([
    listConnections({ companyId }),
    canDo(companyId, "manage_connections"),
    canDo(companyId, "reconnect_connection"),
  ]);

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header>
        <H1>Social connections</H1>
        <Lead className="mt-0.5">
          Each platform you publish to has one connection. Reconnect
          flows when a credential expires.
        </Lead>
      </header>

      <div className="mt-6">
        <ConnectBanner params={searchParams ?? {}} />
        {listResult.ok ? (
          <SocialConnectionsList
            companyId={companyId}
            connections={listResult.data.connections}
            canManage={canManage}
            canReconnect={canReconnect}
          />
        ) : (
          <div
            className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
            role="alert"
            data-testid="connections-error"
          >
            Failed to load connections: {listResult.error.message}
          </div>
        )}
      </div>
    </main>
  );
}
