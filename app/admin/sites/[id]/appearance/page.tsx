import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppearancePanelClient } from "@/components/AppearancePanelClient";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ExtractedProfilePanel } from "@/components/ExtractedProfilePanel";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { H1, Lead } from "@/components/ui/typography";
import { checkAdminAccess } from "@/lib/admin-gate";
import { listAppearanceEventsForSite } from "@/lib/appearance-events";
import { getSite } from "@/lib/sites";
import { getServiceRoleClient } from "@/lib/supabase";

// /admin/sites/[id]/appearance — DESIGN-SYSTEM-OVERHAUL PR 8.
//
// Mode-aware Appearance panel. Three states:
//
//   site_mode IS NULL    → empty state with link to /onboarding.
//                          The Kadence/preflight stack is gated behind
//                          a confirmed mode choice; rendering it for
//                          unonboarded sites is what produced the
//                          "context_build_failed" leak under M13-5d.
//
//   copy_existing        → ExtractedProfilePanel: read-only summary of
//                          the PR 7 extraction + Re-extract link. No
//                          Kadence sync — copy_existing sites use the
//                          host theme's styling.
//
//   new_design           → existing AppearancePanelClient. Owns the
//                          /preflight + /sync-palette + /rollback
//                          state machine for Kadence-backed sites.

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SiteAppearancePage({
  params,
}: {
  params: { id: string };
}) {
  const access = await checkAdminAccess({
    requiredRoles: ["super_admin", "admin"],
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

  const svc = getServiceRoleClient();
  const modeRes = await svc
    .from("sites")
    .select(
      "site_mode, extracted_design, extracted_css_classes, kadence_installed_at, kadence_globals_synced_at, version_lock",
    )
    .eq("id", params.id)
    .single();

  const modeRow = modeRes.data as {
    site_mode: string | null;
    extracted_design: unknown;
    extracted_css_classes: unknown;
    kadence_installed_at: string | null;
    kadence_globals_synced_at: string | null;
    version_lock: number;
  };

  const breadcrumbs = (
    <Breadcrumbs
      crumbs={[
        { label: "Sites", href: "/admin/sites" },
        { label: site.name, href: `/admin/sites/${site.id}` },
        { label: "Appearance" },
      ]}
    />
  );

  if (modeRow.site_mode === null) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        {breadcrumbs}
        <div className="mt-6 max-w-2xl">
          <H1>{site.name}</H1>
          <Lead className="mt-1">Appearance</Lead>
          <Alert className="mt-6" title="Finish setting up this site first">
            Pick whether we&apos;re uploading content to an existing WordPress
            theme or building a fresh design before opening Appearance.
            Generation styling and the rest of setup follow from this choice.
          </Alert>
          <Button asChild className="mt-4">
            <Link href={`/admin/sites/${site.id}/onboarding`}>
              Go to onboarding →
            </Link>
          </Button>
        </div>
      </main>
    );
  }

  if (modeRow.site_mode === "copy_existing") {
    return (
      <main className="mx-auto max-w-5xl p-6">
        {breadcrumbs}
        <ExtractedProfilePanel
          siteId={site.id}
          siteName={site.name}
          siteUrl={site.wp_url}
          extractedDesign={modeRow.extracted_design}
          extractedClasses={modeRow.extracted_css_classes}
        />
      </main>
    );
  }

  // new_design — preserve the existing Kadence-aware panel verbatim.
  const events = await listAppearanceEventsForSite(params.id, 20);

  return (
    <main className="mx-auto max-w-5xl p-6">
      {breadcrumbs}
      <AppearancePanelClient
        siteId={site.id}
        siteName={site.name}
        siteWpUrl={site.wp_url}
        initialKadenceInstalledAt={modeRow.kadence_installed_at}
        initialKadenceGlobalsSyncedAt={modeRow.kadence_globals_synced_at}
        initialSiteVersionLock={modeRow.version_lock}
        initialEvents={events}
      />
    </main>
  );
}
