import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SiteOnboardingForm } from "@/components/SiteOnboardingForm";
import { Alert } from "@/components/ui/alert";
import { H1, H3, Lead } from "@/components/ui/typography";
import { checkAdminAccess } from "@/lib/admin-gate";
import { getServiceRoleClient } from "@/lib/supabase";

// /admin/sites/[id]/onboarding — DESIGN-SYSTEM-OVERHAUL PR 6.
//
// Mode-selection screen for the unified setup flow. Renders before
// either the existing DESIGN-DISCOVERY wizard or the new copy-existing
// extraction (PR 7). On submit, sets sites.site_mode and redirects to
// the appropriate downstream surface.
//
// Already-onboarded sites land here via deep link or banner click;
// they're redirected straight to the right downstream surface so the
// operator doesn't have to pick the same mode twice.

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SiteOnboardingPage({
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
    .select("id, name, site_mode")
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

  const site = res.data as { id: string; name: string; site_mode: string | null };

  if (site.site_mode === "copy_existing") {
    redirect(`/admin/sites/${site.id}/setup/extract`);
  }
  if (site.site_mode === "new_design") {
    redirect(`/admin/sites/${site.id}/setup?step=1`);
  }

  return (
    <>
      <Breadcrumbs
        crumbs={[
          { label: "Admin", href: "/admin/sites" },
          { label: "Sites", href: "/admin/sites" },
          { label: site.name, href: `/admin/sites/${site.id}` },
          { label: "Onboarding" },
        ]}
      />

      <div className="mt-4 max-w-3xl">
        <H1>How would you like to use this site?</H1>
        <Lead className="mt-2">
          Pick one. We&apos;ll tailor the rest of the setup — and how
          generated content is styled — based on your choice. You can
          re-onboard later if you change your mind.
        </Lead>

        <SiteOnboardingForm siteId={site.id} />

        <section className="mt-10 border-t pt-6">
          <H3>Not sure which to pick?</H3>
          <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">Upload to existing</strong>{" "}
              suits a client whose WordPress site already looks the way they
              want it. We extract the colours, fonts, and class names so new
              content matches the existing chrome.
            </li>
            <li>
              <strong className="text-foreground">Build a new website</strong>{" "}
              suits a fresh site (or a heavy redesign). The setup wizard
              walks through design direction, concepts, tone of voice, and
              the design tokens generation will use.
            </li>
          </ul>
          <Link
            href={`/admin/sites/${site.id}`}
            className="mt-4 inline-block text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to site
          </Link>
        </section>
      </div>
    </>
  );
}
