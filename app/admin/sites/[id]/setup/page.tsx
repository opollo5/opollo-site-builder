import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SetupWizard } from "@/components/SetupWizard";
import { H1, Lead } from "@/components/ui/typography";
import { checkAdminAccess } from "@/lib/admin-gate";
import {
  computeResumeStep,
  getSetupStatus,
  type SetupStep,
} from "@/lib/site-setup";
import { getSite } from "@/lib/sites";

// ---------------------------------------------------------------------------
// /admin/sites/[id]/setup — DESIGN-DISCOVERY wizard.
//
// Three-step setup that runs once per site after registration:
//   1. Design direction — operator-supplied references / description /
//      industry → 3 generated concepts → approve one (PRs 4–7).
//   2. Tone of voice — sample copy + guided questions → tone JSON +
//      approved samples (PR 8) → live tone application (PR 9).
//   3. Done — summary + "Start generating content" CTA.
//
// Step is persisted in the URL (?step=1|2|3). When a step query param
// is missing, we redirect to the resume step computed from the two
// status columns. If both statuses are 'pending' the wizard opens
// fresh at Step 1; once a step is 'approved' or 'skipped' it counts
// as complete for navigation.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

function parseStep(input: string | string[] | undefined): SetupStep | null {
  const raw = Array.isArray(input) ? input[0] : input;
  if (raw === "1") return 1;
  if (raw === "2") return 2;
  if (raw === "3") return 3;
  return null;
}

export default async function SiteSetupPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { step?: string | string[] };
}) {
  const access = await checkAdminAccess({
    requiredRoles: ["super_admin", "admin"],
    insufficientRoleRedirectTo: "/",
  });
  if (access.kind === "redirect") redirect(access.to);

  const siteResult = await getSite(params.id);
  if (!siteResult.ok) {
    if (siteResult.error.code === "NOT_FOUND") notFound();
    return (
      <div
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        role="alert"
      >
        {siteResult.error.message}
      </div>
    );
  }
  const site = siteResult.data.site;

  const statusResult = await getSetupStatus(params.id);
  if (!statusResult.ok) {
    if (statusResult.error.code === "NOT_FOUND") notFound();
    return (
      <div
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        role="alert"
      >
        {statusResult.error.message}
      </div>
    );
  }
  const status = statusResult.data;

  // No explicit step → resume from status. Already-set step out of
  // range falls back to the resume step too.
  const requested = parseStep(searchParams.step);
  if (requested === null) {
    const resume = computeResumeStep(status);
    redirect(`/admin/sites/${params.id}/setup?step=${resume}`);
  }
  const step: SetupStep = requested;

  return (
    <div className="mx-auto max-w-4xl">
      <Breadcrumbs
        crumbs={[
          { label: "Sites", href: "/admin/sites" },
          { label: site.name, href: `/admin/sites/${site.id}` },
          { label: "Setup" },
        ]}
      />
      <H1 className="mt-2">Set up {site.name}</H1>
      <Lead className="mt-1">
        A two-step setup that gives every generated page a consistent
        look and voice. Skip any step to fall back to the default
        styles — you can return any time.
      </Lead>

      <div className="mt-6">
        <SetupWizard
          siteId={site.id}
          step={step}
          status={status}
        />
      </div>
    </div>
  );
}
