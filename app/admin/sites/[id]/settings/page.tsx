import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SiteVoiceSettingsForm } from "@/components/SiteVoiceSettingsForm";
import { H1 } from "@/components/ui/typography";
import { checkAdminAccess } from "@/lib/admin-gate";
import { getSite } from "@/lib/sites";

// /admin/sites/[id]/settings — RS-2.
//
// Site-level settings surface. Today: brand voice + design direction
// defaults that the brief commit form inherits. Future home for site
// theme overrides, post-mode toggle, etc.
//
// Operator role can edit (matches voice/direction's editorial nature
// and the API gate on /voice).

export const dynamic = "force-dynamic";

export default async function SiteSettingsPage({
  params,
}: {
  params: { id: string };
}) {
  const access = await checkAdminAccess({
    requiredRoles: ["admin", "operator"],
    insufficientRoleRedirectTo: "/",
  });
  if (access.kind === "redirect") redirect(access.to);

  const result = await getSite(params.id);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <main className="mx-auto max-w-3xl p-6">
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          {result.error.message}
        </div>
      </main>
    );
  }
  const site = result.data.site;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Breadcrumbs
        crumbs={[
          { label: "Admin", href: "/admin/sites" },
          { label: "Sites", href: "/admin/sites" },
          { label: site.name, href: `/admin/sites/${site.id}` },
          { label: "Settings" },
        ]}
      />
      <H1 className="mt-2">{site.name} — Settings</H1>
      <p className="mt-1 text-sm text-muted-foreground">
        These values pre-populate every new brief. Each brief can still
        override at commit time without changing the site default.
      </p>

      <section
        aria-labelledby="voice-heading"
        className="mt-6 rounded-lg border p-4"
      >
        <h2 id="voice-heading" className="text-base font-semibold">
          Brand voice &amp; design direction
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Set once for the site; the brief commit form inherits these as
          defaults.
        </p>
        <div className="mt-4">
          <SiteVoiceSettingsForm
            siteId={site.id}
            initialBrandVoice={site.brand_voice}
            initialDesignDirection={site.design_direction}
            initialVersionLock={site.version_lock}
          />
        </div>
      </section>
    </main>
  );
}
