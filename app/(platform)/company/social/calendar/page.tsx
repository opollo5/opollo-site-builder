import { redirect } from "next/navigation";

import { CalendarShell } from "@/components/social/dashboard/CalendarShell";
import { getCurrentPlatformSession } from "@/lib/platform/auth";
import { listConnections } from "@/lib/platform/social/connections";
import type { Connection, Platform } from "@/lib/social/types";

// ---------------------------------------------------------------------------
// /company/social/calendar — full social dashboard (DnD, bulk CSV, analytics).
//
// Replaced SocialCalendarClient (lite, no DnD) with CalendarShell (full
// social-01 implementation: 7-col month grid, DnD reschedule, day-detail
// panel, bulk CSV upload, post analytics modal, timeline toggle, profile
// filter). CalendarShell uses its own composer state via useComposerState;
// the layout-level ComposerMountV2 remains available for ?compose= URL-param
// deep-links (CAP push-to-composer, direct links).
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

function mapSocialPlatform(p: string): Platform {
  if (p === "linkedin_personal" || p === "linkedin_company") return "linkedin";
  if (p === "facebook_page") return "facebook";
  if (p === "instagram_business") return "instagram";
  if (p === "gbp") return "google_business_profile";
  return p as Platform;
}

export default async function CompanySocialCalendarPage() {
  const session = await getCurrentPlatformSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent("/company/social/calendar")}`);
  }
  if (!session.company) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        <p className="font-medium">No company context.</p>
      </div>
    );
  }

  const companyId = session.company.companyId;
  const connectionsResult = await listConnections({ companyId });
  const rawConnections = connectionsResult.ok ? connectionsResult.data.connections : [];
  const availableConnections: Connection[] = rawConnections
    .filter((c) => c.status !== "disconnected")
    .map((c) => ({
      id: c.id,
      platform: mapSocialPlatform(c.platform),
      account_name: c.display_name ?? c.platform,
      account_avatar_url: c.avatar_url ?? "",
    }));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <CalendarShell
        companyId={companyId}
        hasConnections={availableConnections.length > 0}
        availableConnections={availableConnections}
      />
    </div>
  );
}
