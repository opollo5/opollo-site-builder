import * as React from "react";
import { redirect } from "next/navigation";

import { getCurrentPlatformSession } from "@/lib/platform/auth";
import { listConnections } from "@/lib/platform/social/connections";
import { CalendarShell } from "@/components/social/dashboard/CalendarShell";
import type { Connection, Platform } from "@/lib/social/types";

// ---------------------------------------------------------------------------
// /social/poster — Social Poster dashboard (PR F).
//
// Server Component: fetches session + connections, then renders the
// CalendarShell client component which owns all calendar state + DnD.
//
// Feature flag: FEATURE_COMPOSER_V2 must be "true".
// ---------------------------------------------------------------------------

const FEATURE_ON = process.env.NEXT_PUBLIC_FEATURE_COMPOSER_V2 === "true";

// Maps V1 SocialPlatform values to V2 Platform values
function mapPlatform(p: string): Platform {
  if (p === "linkedin_personal" || p === "linkedin_company") return "linkedin";
  if (p === "facebook_page") return "facebook";
  if (p === "instagram_business") return "instagram";
  if (p === "gbp") return "google_business_profile";
  return p as Platform;
}

export default async function SocialPosterPage() {
  if (!FEATURE_ON) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        FEATURE_COMPOSER_V2 is not enabled.
      </div>
    );
  }

  const session = await getCurrentPlatformSession();
  if (!session) redirect("/login?next=/social/poster");

  const companyId = session.company?.companyId ?? "";

  const connectionsResult = companyId
    ? await listConnections({ companyId })
    : { ok: false as const, data: undefined };

  const rawConnections =
    connectionsResult.ok && connectionsResult.data
      ? connectionsResult.data.connections
      : [];

  const availableConnections: Connection[] = rawConnections.map((c) => ({
    id: c.id,
    platform: mapPlatform(c.platform),
    account_name: c.display_name ?? c.platform,
    account_avatar_url: c.avatar_url ?? "",
  }));

  return (
    <main className="flex h-full flex-col overflow-hidden">
      <CalendarShell
        companyId={companyId}
        hasConnections={availableConnections.length > 0}
        availableConnections={availableConnections}
      />
    </main>
  );
}
