import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CopyExistingExtractionWizard } from "@/components/CopyExistingExtractionWizard";
import { Alert } from "@/components/ui/alert";
import { H1, Lead } from "@/components/ui/typography";
import { checkAdminAccess } from "@/lib/admin-gate";
import { getServiceRoleClient } from "@/lib/supabase";

// /admin/sites/[id]/setup/extract — DESIGN-SYSTEM-OVERHAUL PR 7.
//
// Copy-existing extraction wizard. Server component loads the site +
// any existing extraction snapshot; the client wizard handles the
// "Run extraction → Review → Confirm" flow.
//
// Gating:
//   - site_mode === 'copy_existing' (operator must have completed
//     onboarding with the right choice)
//   - Other modes redirect back to /onboarding so the operator picks
//     the right path

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CopyExistingExtractPage({
  params,
}: {
  params: { id: string };
}) {
  const access = await checkAdminAccess({
    requiredRoles: ["super_admin", "admin"],
    insufficientRoleRedirectTo: "/",
  });
  if (access.kind === "redirect") redirect(access.to);

  if (!UUID_RE.test(params.id)) notFound();

  const supabase = getServiceRoleClient();
  const res = await supabase
    .from("sites")
    .select("id, name, wp_url, site_mode, extracted_design, extracted_css_classes")
    .eq("id", params.id)
    .maybeSingle();

  if (res.error) {
    return (
      <Alert variant="destructive" title="Failed to load site">
        {res.error.message}
      </Alert>
    );
  }
  if (!res.data) notFound();

  const site = res.data as {
    id: string;
    name: string;
    wp_url: string;
    site_mode: string | null;
    extracted_design: unknown;
    extracted_css_classes: unknown;
  };

  if (site.site_mode === null) {
    redirect(`/admin/sites/${site.id}/onboarding`);
  }
  if (site.site_mode !== "copy_existing") {
    redirect(`/admin/sites/${site.id}/onboarding`);
  }

  return (
    <>
      <Breadcrumbs
        crumbs={[
          { label: "Admin", href: "/admin/sites" },
          { label: "Sites", href: "/admin/sites" },
          { label: site.name, href: `/admin/sites/${site.id}` },
          { label: "Extract design" },
        ]}
      />

      <div className="mt-4 max-w-3xl">
        <H1>Extract design from {site.wp_url}</H1>
        <Lead className="mt-2">
          We&apos;ll fetch your live site and pull out the colours, fonts, and
          common CSS class names so generated content matches the existing
          theme. Review and tweak before saving.
        </Lead>

        <CopyExistingExtractionWizard
          siteId={site.id}
          siteUrl={site.wp_url}
          existingDesign={site.extracted_design}
          existingClasses={site.extracted_css_classes}
        />
      </div>
    </>
  );
}
