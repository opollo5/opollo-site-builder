import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SiteVoiceSettingsForm } from "@/components/SiteVoiceSettingsForm";
import { UseImageLibraryToggle } from "@/components/UseImageLibraryToggle";
import { Alert } from "@/components/ui/alert";
import { H1, H2, Lead } from "@/components/ui/typography";
import { checkAdminAccess } from "@/lib/admin-gate";
import { getSite } from "@/lib/sites";
import { getServiceRoleClient } from "@/lib/supabase";

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
    requiredRoles: ["super_admin", "admin"],
    insufficientRoleRedirectTo: "/",
  });
  if (access.kind === "redirect") redirect(access.to);

  const result = await getSite(params.id);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <div className="mx-auto max-w-3xl">
        <Alert variant="destructive">{result.error.message}</Alert>
      </div>
    );
  }
  const site = result.data.site;

  const svc = getServiceRoleClient();
  const [useImageLibraryRow, imageCountRow, metadataCountRow] =
    await Promise.all([
      svc
        .from("sites")
        .select("use_image_library")
        .eq("id", site.id)
        .maybeSingle(),
      svc
        .from("image_library")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null),
      svc
        .from("image_library")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .not("caption", "is", null)
        .not("alt_text", "is", null),
    ]);

  const useImageLibrary =
    (useImageLibraryRow.data?.use_image_library as boolean | undefined) ?? false;
  const totalImages = imageCountRow.count ?? 0;
  const imagesWithMetadata = metadataCountRow.count ?? 0;

  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumbs
        crumbs={[
          { label: "Admin", href: "/admin/sites" },
          { label: "Sites", href: "/admin/sites" },
          { label: site.name, href: `/admin/sites/${site.id}` },
          { label: "Settings" },
        ]}
      />
      <H1 className="mt-2">{site.name} — Settings</H1>
      <Lead className="mt-1">
        These values pre-populate every new brief. Each brief can still
        override at commit time without changing the site default.
      </Lead>

      <section
        aria-labelledby="voice-heading"
        className="mt-6 rounded-lg border p-4"
      >
        <H2 id="voice-heading">Brand voice &amp; design direction</H2>
        <p className="mt-1 text-sm text-muted-foreground">
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

      <section
        aria-labelledby="image-library-heading"
        className="mt-6 rounded-lg border p-4"
      >
        <H2 id="image-library-heading">Image library</H2>
        <p className="mt-1 text-sm text-muted-foreground">
          When enabled, brief generation can suggest images from the shared
          library where the page topic matches.
        </p>
        <div className="mt-4">
          <UseImageLibraryToggle
            siteId={site.id}
            initialEnabled={useImageLibrary}
            totalImages={totalImages}
            imagesWithMetadata={imagesWithMetadata}
          />
        </div>
      </section>
    </div>
  );
}
