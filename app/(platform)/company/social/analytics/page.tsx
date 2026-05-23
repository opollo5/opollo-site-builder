import nextDynamic from "next/dynamic";
import { redirect } from "next/navigation";

import { canDo, getCurrentPlatformSession } from "@/lib/platform/auth";
import { getSocialAnalytics } from "@/lib/platform/social/analytics";
import { TDashboardKpi } from "@/templates";

const SocialAnalyticsClient = nextDynamic(
  () =>
    import("@/components/SocialAnalyticsClient").then(
      (m) => m.SocialAnalyticsClient,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="animate-pulse space-y-4 p-6">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-32 rounded-lg bg-muted" />
        ))}
      </div>
    ),
  },
);

// ---------------------------------------------------------------------------
// /company/social/analytics — company-scoped social analytics page.
//
// Server-rendered. Same gating pattern as the rest of /company:
//   1. No session → /login.
//   2. No company membership → "Not provisioned" envelope.
//   3. Viewer+ (canDo("view_calendar")) can see analytics — same
//      threshold as the posts list.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export default async function CompanySocialAnalyticsPage() {
  const session = await getCurrentPlatformSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent("/company/social/analytics")}`);
  }

  if (!session.company) {
    return (
      <TDashboardKpi
        title="Analytics"
        kpis={[]}
        dataSections={[{
          title: "Access",
          content: (
            <div className="rounded-md border border-warning-border bg-warning-bg p-4 text-base">
              <p className="font-medium">Account not provisioned to a company.</p>
              <p className="mt-1 text-muted-foreground">
                Your account isn&apos;t a member of any company on the platform
                yet. Ask an admin to invite you, or contact Opollo support.
              </p>
            </div>
          ),
        }]}
      />
    );
  }

  const companyId = session.company.companyId;
  const canView = await canDo(companyId, "view_calendar");
  if (!canView) {
    return (
      <TDashboardKpi
        title="Analytics"
        kpis={[]}
        dataSections={[{
          title: "Access",
          content: (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-destructive">
              <p className="font-medium">Access denied.</p>
              <p className="mt-1">
                Your role doesn&apos;t have access to analytics. Ask an admin
                to elevate your permissions.
              </p>
            </div>
          ),
        }]}
      />
    );
  }

  const result = await getSocialAnalytics(companyId);

  if (!result.ok) {
    return (
      <TDashboardKpi
        title="Analytics"
        kpis={[]}
        dataSections={[{
          title: "Error",
          content: (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-base text-destructive"
              role="alert"
              data-testid="analytics-error"
            >
              Failed to load analytics: {result.error.message}
            </div>
          ),
        }]}
      />
    );
  }

  return (
    <TDashboardKpi
      title="Analytics"
      breadcrumb={[
        { label: "Social", href: "/company/social" },
        { label: "Analytics" },
      ]}
      kpis={[]}
      dataSections={[{
        title: "Performance overview",
        content: <SocialAnalyticsClient data={result.data} />,
      }]}
    />
  );
}
