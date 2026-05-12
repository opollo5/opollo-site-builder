import { redirect } from "next/navigation";

import { PopupChannelPicker } from "@/components/PopupChannelPicker";
import { canDo, getCurrentPlatformSession } from "@/lib/platform/auth";
import { CHANNEL_SELECTION_PLATFORMS } from "@/lib/platform/social/connections/identity";
import { dbPlatformToBundleType } from "@/lib/platform/social/connections/route-helpers";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// /connect/pick-channel?connection_id=<uuid>
//
// Popup-mode channel-picker page. The OAuth callback (callback/route.ts)
// 302s the popup to this URL when a channel-selection platform's row was
// inserted in 'pending_identity'. The popup loads the page, the user
// picks a channel here, then PopupChannelPicker fires a postMessage to
// window.opener and closes itself.
//
// Lives OUTSIDE the (platform) route group so it doesn't inherit
// NavShell — the popup viewport is small (600×700) and the chrome would
// fight with the picker.
//
// Auth: getCurrentPlatformSession + canDo("manage_connections", company).
// A connection_id that doesn't belong to the signed-in user's company
// 302s the popup to /company/social/connections (route-abuse defense).
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

type SearchParams = {
  connection_id?: string;
};

const UUID_RE = /^[0-9a-f-]{36}$/i;

const PLATFORM_LABEL_FOR_BUNDLE: Record<
  "LINKEDIN" | "FACEBOOK" | "INSTAGRAM" | "YOUTUBE" | "GOOGLE_BUSINESS",
  string
> = {
  LINKEDIN: "LinkedIn",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  YOUTUBE: "YouTube",
  GOOGLE_BUSINESS: "Google Business",
};

export default async function PickChannelPopupPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const connectionId = searchParams.connection_id;
  if (!connectionId || !UUID_RE.test(connectionId)) {
    redirect("/company/social/connections");
  }

  const session = await getCurrentPlatformSession();
  if (!session) {
    // Not signed in — kick to login. Popup will end up at /login with
    // no opener relationship; user can close it. Better than rendering
    // an empty popup.
    redirect("/login");
  }

  const svc = getServiceRoleClient();
  const { data: connRow, error: connErr } = await svc
    .from("social_connections")
    .select("id, company_id, platform, status, is_personal_mode")
    .eq("id", connectionId)
    .maybeSingle();
  if (connErr || !connRow) {
    redirect("/company/social/connections");
  }
  const conn = connRow as {
    id: string;
    company_id: string;
    platform:
      | "linkedin_personal"
      | "linkedin_company"
      | "facebook_page"
      | "x"
      | "gbp";
    status: string;
    is_personal_mode: boolean | null;
  };

  // Route-abuse defense: the signed-in user must be able to manage
  // connections on the connection's company. Anything else → bounce
  // out without leaking which company id was tried.
  if (
    !session.company ||
    session.company.companyId !== conn.company_id ||
    !(await canDo(conn.company_id, "manage_connections"))
  ) {
    redirect("/company/social/connections");
  }

  const bundlePlatform = dbPlatformToBundleType(conn.platform);
  if (!CHANNEL_SELECTION_PLATFORMS.has(bundlePlatform)) {
    // Not a channel-selection platform — there's nothing to pick. Bounce.
    redirect("/company/social/connections");
  }

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ??
    "https://opollo-site-builder.vercel.app";

  return (
    <PopupChannelPicker
      connectionId={conn.id}
      platform={bundlePlatform as "LINKEDIN" | "FACEBOOK" | "INSTAGRAM" | "YOUTUBE" | "GOOGLE_BUSINESS"}
      platformLabel={
        PLATFORM_LABEL_FOR_BUNDLE[
          bundlePlatform as "LINKEDIN" | "FACEBOOK" | "INSTAGRAM" | "YOUTUBE" | "GOOGLE_BUSINESS"
        ]
      }
      origin={origin}
    />
  );
}
