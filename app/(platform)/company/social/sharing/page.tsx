import { redirect } from "next/navigation";

import { ViewerLinksManager } from "@/components/ViewerLinksManager";
import { Alert } from "@/components/ui/alert";
import { TSettingsFlat } from "@/templates";
import { canDo, getCurrentPlatformSession } from "@/lib/platform/auth";
import { listViewerLinks } from "@/lib/platform/social/viewer-links";

// ---------------------------------------------------------------------------
// S1-15 — admin-only page to manage viewer-link sharing.
//
// Same gating shape as /company/users:
//   1. No session → /login.
//   2. No company membership → "Not provisioned" envelope.
//   3. Non-admin role → "Admins only" panel.
//
// canDo("manage_invitations") is the threshold: admins-only, since
// these links are public-facing and have no further auth check.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const BREADCRUMB = [
  { label: "Company", href: "/company" },
  { label: "Social", href: "/company/social/posts" },
  { label: "Sharing" },
];

export default async function CompanySocialSharingPage() {
  const session = await getCurrentPlatformSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent("/company/social/sharing")}`);
  }

  if (!session.company) {
    return (
      <TSettingsFlat
        title="Calendar sharing"
        breadcrumb={BREADCRUMB}
        inlineAlerts={[
          <Alert key="not-provisioned">
            <p className="font-medium">Account not provisioned to a company.</p>
            <p className="mt-1 text-muted-foreground">
              Your account isn&apos;t a member of any company on the
              platform yet. Ask an admin to invite you, or contact
              Opollo support.
            </p>
          </Alert>,
        ]}
        sections={[]}
      />
    );
  }

  const companyId = session.company.companyId;
  const isAdmin = await canDo(companyId, "manage_invitations");
  if (!isAdmin) {
    return (
      <TSettingsFlat
        title="Calendar sharing"
        breadcrumb={BREADCRUMB}
        inlineAlerts={[
          <Alert key="admins-only" variant="destructive">
            <p className="font-medium">Admins only.</p>
            <p className="mt-1">
              Only admins can manage calendar-sharing links. Ask an admin
              in your company to share the calendar with you, or to
              promote your role.
            </p>
          </Alert>,
        ]}
        sections={[]}
      />
    );
  }

  const linksResult = await listViewerLinks({ companyId });

  return (
    <TSettingsFlat
      title="Calendar sharing"
      breadcrumb={BREADCRUMB}
      subtitle="Mint 90-day read-only links to share the content calendar with clients or stakeholders. They don't need an Opollo account."
      sections={[{
        title: "Viewer links",
        content: linksResult.ok ? (
          <ViewerLinksManager
            companyId={companyId}
            initialLinks={linksResult.data.links}
          />
        ) : (
          <div
            className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-base text-destructive"
            role="alert"
            data-testid="viewer-links-load-error"
          >
            Failed to load viewer links: {linksResult.error.message}
          </div>
        ),
      }]}
    />
  );
}
