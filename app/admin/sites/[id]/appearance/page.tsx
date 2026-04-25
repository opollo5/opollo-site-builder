import { notFound, redirect } from "next/navigation";

import { AppearancePanelClient } from "@/components/AppearancePanelClient";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { checkAdminAccess } from "@/lib/admin-gate";
import { listAppearanceEventsForSite } from "@/lib/appearance-events";
import { getSite } from "@/lib/sites";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// /admin/sites/[id]/appearance — M13-5d.
//
// Server Component. Loads only Opollo-side state — no WP calls here,
// because:
//   1. WP calls hit the operator's WordPress; if it's down, every
//      panel render would block.
//   2. Calling /preflight server-side would write a preflight_run
//      audit event on every page load (refresh, navigation, etc.) —
//      the audit log would be dominated by render noise.
//
// The client component fires POST /preflight on mount instead. That:
//   - Writes one preflight_run event per session (operator-visible
//     activity, useful for incident reconstruction)
//   - Stamps sites.kadence_installed_at on first confirmed detection
//   - Returns the full context (install / palette / proposal / diff)
//     for the panel to render
//
// The server side carries the operator-trustable state: site row +
// kadence_* timestamps from sites + last 20 appearance_events for
// the audit-log section.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SiteAppearancePage({
  params,
}: {
  params: { id: string };
}) {
  const access = await checkAdminAccess({
    requiredRoles: ["admin", "operator"],
    insufficientRoleRedirectTo: "/admin/sites",
  });
  if (access.kind === "redirect") redirect(access.to);

  if (!UUID_RE.test(params.id)) notFound();

  const siteRes = await getSite(params.id);
  if (!siteRes.ok) {
    if (siteRes.error.code === "NOT_FOUND") notFound();
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
      >
        Failed to load site: {siteRes.error.message}
      </div>
    );
  }
  const site = siteRes.data.site;

  // Read kadence timestamps + version_lock directly — SiteRecord
  // doesn't carry these.
  const svc = getServiceRoleClient();
  const kadenceRes = await svc
    .from("sites")
    .select(
      "kadence_installed_at, kadence_globals_synced_at, version_lock",
    )
    .eq("id", params.id)
    .single();

  const kadence = kadenceRes.data as {
    kadence_installed_at: string | null;
    kadence_globals_synced_at: string | null;
    version_lock: number;
  };

  // Last 20 appearance_events for the panel's event-log section.
  const events = await listAppearanceEventsForSite(params.id, 20);

  return (
    <main className="mx-auto max-w-5xl p-6">
      <Breadcrumbs
        crumbs={[
          { label: "Sites", href: "/admin/sites" },
          { label: site.name, href: `/admin/sites/${site.id}` },
          { label: "Appearance" },
        ]}
      />
      <AppearancePanelClient
        siteId={site.id}
        siteName={site.name}
        siteWpUrl={site.wp_url}
        initialKadenceInstalledAt={kadence.kadence_installed_at}
        initialKadenceGlobalsSyncedAt={kadence.kadence_globals_synced_at}
        initialSiteVersionLock={kadence.version_lock}
        initialEvents={events}
      />
    </main>
  );
}
