import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { NavIcon } from "@/components/ui/nav-icon";
import { ComposerMountV2 } from "@/components/composer/composer-mount-v2";
import { getCurrentPlatformSession } from "@/lib/platform/auth";
import { listConnections } from "@/lib/platform/social/connections";
import type { Connection, Platform } from "@/lib/social/types";

// /company/social/* — session + company guard.
//
// The nav shell lives in app/company/layout.tsx (NavShell).
// This layout enforces that the visitor has a company context. For Opollo
// staff who haven't yet selected a company via the Social section nav
// selector, we render an inline prompt rather than redirecting.
//
// Mounts ComposerOverlay (V2) via ComposerMountV2 so it is available on
// every social sub-route via ?compose=new or ?compose=<id>.

export default async function CompanySocialLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getCurrentPlatformSession();
  if (!session) {
    redirect("/login");
  }
  if (!session.company) {
    if (session.isOpolloStaff) {
      return (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-4 text-center">
          <NavIcon name="apartment" size={36} className="text-tx-muted" />
          <p className="text-base font-medium">Select a company to continue</p>
          <p className="max-w-xs text-sm text-tx-muted">
            Use the company selector in the Social navigation panel to choose a
            client, then navigate here again.
          </p>
        </div>
      );
    }
    redirect("/company");
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
    <>
      {children}
      <ComposerMountV2
        companyId={companyId}
        availableConnections={availableConnections}
      />
    </>
  );
}

// Maps V1 SocialPlatform values to V2 Platform values.
function mapSocialPlatform(p: string): Platform {
  if (p === "linkedin_personal" || p === "linkedin_company") return "linkedin";
  if (p === "facebook_page") return "facebook";
  if (p === "instagram_business") return "instagram";
  if (p === "gbp") return "google_business_profile";
  return p as Platform;
}
