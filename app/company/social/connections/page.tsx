import { redirect } from "next/navigation";

import { SocialConnectionsList } from "@/components/SocialConnectionsList";
import { H1, Lead } from "@/components/ui/typography";
import { canDo, getCurrentPlatformSession } from "@/lib/platform/auth";
import { listConnections } from "@/lib/platform/social/connections";

// ---------------------------------------------------------------------------
// S1-12 — customer connections roster at /company/social/connections.
//
// Server-rendered. Same gating pattern as the rest of /company:
//   1. No session → /login.
//   2. No company membership → "Not provisioned" envelope.
//
// Read gate: any company member (viewer+ via canDo("view_calendar")).
// Manage gate: admin (canDo("manage_connections")) drives the
// Reconnect button visibility on individual rows.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export default async function CompanySocialConnectionsPage() {
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

  const [listResult, canManage] = await Promise.all([
    listConnections({ companyId }),
    canDo(companyId, "manage_connections"),
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
        {listResult.ok ? (
          <SocialConnectionsList
            connections={listResult.data.connections}
            canManage={canManage}
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
