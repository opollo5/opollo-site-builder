import { redirect } from "next/navigation";

import { SocialConnectionsList } from "@/components/SocialConnectionsList";
import { Alert } from "@/components/ui/alert";
import { H1, Lead } from "@/components/ui/typography";
import { canDo, getCurrentPlatformSession } from "@/lib/platform/auth";
import { listConnections } from "@/lib/platform/social/connections";
import { emitOverdueEventsIfNeeded } from "@/lib/platform/social/connections/overdue-events";
import { listProfilesForCompany } from "@/lib/platform/social/profiles";

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
  // Channel-selection flow (incident 2026-05-12): the callback route
  // sets this on success-with-channel-needed so the client can auto-
  // open the channel-picker modal against the freshly-inserted row.
  connection_id?: string;
  // Bug-fix 2026-05-12: set on noop+updated to identify which platform
  // the user tried to connect (already had one). Drives the actionable
  // "already connected" banner + row highlight in SocialConnectionsList.
  attempted_platform?: string;
};

const REASON_LABEL: Record<string, string> = {
  "not-enough-permissions":
    "The connected account didn't grant all the permissions Opollo needs.",
  "not-enough-pages": "No eligible pages were attached to that account.",
  "auth-failed": "The platform rejected the sign-in.",
  "user-cancelled": "You cancelled the connection flow.",
  // Channel-selection flow (incident 2026-05-12). Platform-specific
  // error codes surfaced when the user's OAuth grant is valid but the
  // account lacks the resource needed to publish — no admin orgs on
  // LinkedIn, no business pages on Facebook, etc.
  "not-enough-channels":
    "Your account doesn't admin any pages or channels for this platform. " +
    "Connect a different account or, for LinkedIn, choose personal-mode.",
  "not-enough-accounts":
    "Your Instagram account isn't linked to a Facebook Page. " +
    "Link them via Meta Business Suite, then reconnect here.",
  "not-enough-servers":
    "Your Discord account doesn't admin any servers Opollo can post to.",
  "not-enough-workspaces":
    "Your Slack account isn't a member of any workspace Opollo can post to.",
  // Cross-tenant identity-leak defence (migration 0122). Set by the
  // sync layer when checkCrossTenantConflict refuses an INSERT because
  // the same platform identity is already owned by another company.
  "cross-tenant-blocked":
    "This account is already connected to another company on the Opollo " +
    "platform. Disconnect it there first, or contact support to set up " +
    "multi-company sharing.",
};

function ConnectBanner({ params }: { params: SearchParams }) {
  if (!params.connect) return null;
  // Channel-selection flow: the channel-picker modal handles its own
  // UX state. The banner stays silent so the modal isn't competing
  // for attention.
  if (params.connect === "needs_channel") return null;
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
  if (params.connect === "sync-failed") {
    return (
      <div
        className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        role="alert"
        data-testid="connect-banner-sync-failed"
      >
        Accounts may be connected but sync is still pending — try Refresh.
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

  const [listResult, canManage, canReconnect, profiles] = await Promise.all([
    listConnections({ companyId }),
    canDo(companyId, "manage_connections"),
    canDo(companyId, "reconnect_connection"),
    listProfilesForCompany(companyId),
  ]);

  // BSP-9: render one section per profile. Migration 0119's trigger
  // guarantees at least one (default) profile per company, so this is
  // never empty for an active company. Single-default-profile
  // companies see one section that's visually equivalent to the
  // pre-BSP-9 page (no per-profile chrome shown when there's only one).
  const hasMultipleProfiles = profiles.length > 1;
  // Bucket connections by profile_id. Unattributed connections
  // (profile_id NULL) fall into the default profile so they remain
  // visible while the next sync re-attributes.
  const buckets: Record<
    string,
    import("@/lib/platform/social/connections/types").SocialConnection[]
  > = {};
  if (listResult.ok) {
    // Channel-selection flow: emit connection_channel_overdue events
    // for any pending_identity rows > 24h that haven't emitted yet.
    // The helper flips has_emitted_overdue_event in the DB and returns
    // a patched list so the banner stays in sync with DB state.
    const connections = await emitOverdueEventsIfNeeded(
      listResult.data.connections,
    );
    for (const p of profiles) buckets[p.id] = [];
    const defaultProfileId =
      profiles.find((p) => p.is_default)?.id ?? profiles[0]?.id;
    for (const c of connections) {
      const targetId = c.profile_id ?? defaultProfileId;
      if (targetId && buckets[targetId]) buckets[targetId].push(c);
    }
  }

  return (
    <>
      <header>
        <H1>Social connections</H1>
        <Lead className="mt-0.5">
          Each platform you publish to has one connection. Reconnect
          flows when a credential expires.
        </Lead>
      </header>

      <div className="mt-6 space-y-8">
        <ConnectBanner params={searchParams ?? {}} />
        {!listResult.ok ? (
          <Alert
            variant="destructive"
            data-testid="connections-error"
            reportContext={{ message: `Failed to load connections: ${listResult.error.message}` }}
          >
            Failed to load connections: {listResult.error.message}
          </Alert>
        ) : (
          profiles.map((p) => (
            <section
              key={p.id}
              data-testid={`profile-section-${p.id}`}
              className={hasMultipleProfiles ? "rounded-md border bg-card p-4" : ""}
            >
              {hasMultipleProfiles ? (
                <header className="mb-3 flex items-center justify-between">
                  <h2 className="text-base font-semibold">{p.name}</h2>
                  {p.is_default ? (
                    <span
                      className="rounded-full bg-emerald-100 px-2 py-0.5 text-sm font-medium text-emerald-900"
                      data-testid={`profile-default-pill-${p.id}`}
                    >
                      Default
                    </span>
                  ) : null}
                </header>
              ) : null}
              <SocialConnectionsList
                companyId={companyId}
                profileId={p.id}
                connections={buckets[p.id] ?? []}
                canManage={canManage}
                canReconnect={canReconnect}
                autoOpenPickerForConnectionId={
                  (searchParams ?? {}).connect === "needs_channel"
                    ? ((searchParams ?? {}).connection_id ?? null)
                    : null
                }
                noopdForPlatform={
                  (searchParams ?? {}).connect === "noop"
                    ? ((searchParams ?? {}).attempted_platform ?? null)
                    : null
                }
              />
            </section>
          ))
        )}
      </div>
    </>
  );
}
