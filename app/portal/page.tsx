import { PageHeader } from "@/components/ui/page-header";
import { validate } from "@/lib/platform/magic-link";
import { getServiceRoleClient } from "@/lib/supabase";
import { ReconnectButton } from "./ReconnectButton";

// ---------------------------------------------------------------------------
// /portal?token=<raw_token>
//
// B4 client portal — sessionless. Token IS the auth.
//
// Session model: magic_links row (consumed_at + session_expires_at, 2h TTL).
// platform_session_grants is NOT used — external clients have no auth.users.
//
// SECURITY: company_id is derived SERVER-SIDE from the magic_links row only.
// The client never supplies company_id. validate() reads the row that the
// operator already bound to their company at link issuance time.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

type SocialConnection = {
  id: string;
  platform: string;
  display_name: string | null;
  status: string;
  expires_at: string | null;
  avatar_url: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  healthy:          "Connected",
  degraded:         "Needs attention",
  auth_required:    "Reconnect required",
  disconnected:     "Disconnected",
  pending_identity: "Pending",
};

const STATUS_COLOR: Record<string, string> = {
  healthy:          "bg-green-100 text-green-800",
  degraded:         "bg-yellow-100 text-yellow-800",
  auth_required:    "bg-red-100 text-red-800",
  disconnected:     "bg-red-100 text-red-800",
  pending_identity: "bg-muted text-muted-foreground",
};

export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token || !/^[0-9a-f]{64}$/i.test(token)) {
    return <InvalidPanel message="This link is invalid. Contact your account manager for a new one." />;
  }

  // Session validation — read-only, does not consume again
  const result = await validate(token);
  if (!result.valid) {
    if (result.reason === "session_expired") {
      return (
        <InvalidPanel
          message="Your session has expired."
          cta={{ href: "/proof/request", label: "Request a fresh link" }}
        />
      );
    }
    if (result.reason === "revoked") {
      return (
        <InvalidPanel message="This link has been revoked. Contact your account manager." />
      );
    }
    return <InvalidPanel message="This link is invalid or has expired." />;
  }

  // company_id derived SERVER-SIDE from magic_links row only.
  // subject_id is the connection_id when issued in deep-link mode; null in portal mode.
  const { company_id, subject_id: deepLinkConnectionId } = result.link;

  if (!company_id) {
    return <InvalidPanel message="This link is not associated with a company." />;
  }

  const svc = getServiceRoleClient();

  // Load company name
  const { data: company } = await svc
    .from("platform_companies")
    .select("name")
    .eq("id", company_id)
    .maybeSingle();

  // Load all social connections for this company
  const { data: connections } = await svc
    .from("social_connections")
    .select("id, platform, display_name, status, expires_at, avatar_url")
    .eq("company_id", company_id)
    .is("disconnected_at", null)
    .order("platform");

  const connectionList = (connections ?? []) as SocialConnection[];

  // In deep-link mode, highlight the specific connection the link targeted
  const highlightId = deepLinkConnectionId;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <PageHeader>
        <PageHeader.Title>
          {company?.name ?? "Your company"} — Social connections
        </PageHeader.Title>
        <PageHeader.Subtitle>
          Review and reconnect your social media accounts below.
        </PageHeader.Subtitle>
      </PageHeader>

      {connectionList.length === 0 ? (
        <div className="mt-8 rounded-lg border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No social connections found for this company.
          </p>
        </div>
      ) : (
        <ul className="mt-6 divide-y rounded-lg border bg-card">
          {connectionList.map((conn) => (
            <li
              key={conn.id}
              className={`p-4 ${conn.id === highlightId ? "ring-2 ring-primary ring-inset" : ""}`}
            >
              <div className="flex items-center gap-4">
                {conn.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={conn.avatar_url}
                    alt=""
                    className="h-10 w-10 rounded-full border bg-muted"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border bg-muted text-xs font-medium text-muted-foreground uppercase">
                    {conn.platform.slice(0, 2)}
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground truncate">
                    {conn.display_name ?? conn.platform}
                  </p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {conn.platform.replace(/_/g, " ")}
                    {conn.expires_at && (
                      <> · expires {new Date(conn.expires_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</>
                    )}
                  </p>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[conn.status] ?? ""}`}>
                    {STATUS_LABEL[conn.status] ?? conn.status}
                  </span>

                  {(conn.status === "auth_required" || conn.status === "disconnected") && (
                    // ReconnectButton: client component that opens OAuth popup.
                    // The popup initiation API (/api/portal/connections/[id]/reconnect)
                    // is wired in Step 5 — button is rendered now, API built next.
                    <ReconnectButton
                      connectionId={conn.id}
                      token={token}
                      platform={conn.platform}
                    />
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 text-center text-xs text-muted-foreground">
        This link is valid for your current session.
        If your session expires, request a fresh link from your account manager.
      </p>
    </main>
  );
}

function InvalidPanel({
  message,
  cta,
}: {
  message: string;
  cta?: { href: string; label: string };
}) {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-page-title text-foreground">Portal unavailable</h1>
      <p className="mt-3 text-sm text-muted-foreground">{message}</p>
      {cta && (
        <a
          href={cta.href}
          className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          {cta.label}
        </a>
      )}
    </main>
  );
}
