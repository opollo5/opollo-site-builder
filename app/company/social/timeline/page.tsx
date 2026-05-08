import { redirect } from "next/navigation";

import { SocialModuleShell } from "@/components/social/social-module-shell";
import { getCurrentPlatformSession } from "@/lib/platform/auth";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// /company/social/timeline — placeholder for the chronological timeline view.
//
// The Timeline tab in SocialModuleShell is disabled (coming soon). This page
// is reachable via direct URL navigation. The view will be fleshed out in a
// future slice once the data model for chronological post history is defined.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export default async function CompanySocialTimelinePage() {
  const session = await getCurrentPlatformSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent("/company/social/timeline")}`);
  }
  if (!session.company) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        <p className="font-medium">No company context.</p>
      </div>
    );
  }

  const companyId = session.company.companyId;

  const companyRow = await getServiceRoleClient()
    .from("platform_companies")
    .select("name")
    .eq("id", companyId)
    .maybeSingle();

  const companyName: string =
    (companyRow.data as { name: string } | null)?.name ?? "My company";

  const composerEnabled = process.env.FEATURE_COMPOSER_V2 === "true";

  return (
    <SocialModuleShell
      activeView="timeline"
      companyName={companyName}
      composerEnabled={composerEnabled}
    >
      <div
        className="flex min-h-[24rem] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-gray-200 text-center"
        data-testid="timeline-coming-soon"
      >
        <p className="text-sm font-medium text-tx-primary">
          Timeline coming soon
        </p>
        <p className="max-w-xs text-sm text-tx-muted">
          A chronological view of your social post history will appear here.
        </p>
      </div>
    </SocialModuleShell>
  );
}
