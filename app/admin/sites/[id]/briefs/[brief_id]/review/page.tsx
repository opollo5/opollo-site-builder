import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import { BriefReviewClient } from "@/components/BriefReviewClient";
import { getBriefWithPages } from "@/lib/briefs";
import { getSite } from "@/lib/sites";

// /admin/sites/[id]/briefs/[brief_id]/review — M12-1.
//
// Server Component. Fetches the brief + its pages server-side and
// hands them to <BriefReviewClient /> which owns the editable list +
// commit flow state machine.
//
// RS-3: when brief.status === "committed", the operator never sees
// the review page — we redirect server-side to the run surface so a
// bookmark, browser-back, or direct link skips the dead intermediate
// state. Client-side, the commit handler also pushes to /run on
// success, so the redirect is the safety net for non-flow entries.

export const dynamic = "force-dynamic";

export default async function BriefReviewPage({
  params,
}: {
  params: { id: string; brief_id: string };
}) {
  const [siteResult, briefResult] = await Promise.all([
    getSite(params.id),
    getBriefWithPages(params.brief_id),
  ]);

  if (!siteResult.ok) {
    if (siteResult.error.code === "NOT_FOUND") notFound();
    return (
      <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load site: {siteResult.error.message}
      </div>
    );
  }

  if (!briefResult.ok) {
    if (briefResult.error.code === "NOT_FOUND") notFound();
    return (
      <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load brief: {briefResult.error.message}
      </div>
    );
  }

  if (briefResult.data.brief.site_id !== params.id) notFound();

  if (briefResult.data.brief.status === "committed") {
    redirect(`/admin/sites/${params.id}/briefs/${params.brief_id}/run`);
  }

  const site = siteResult.data.site;
  const { brief, pages } = briefResult.data;

  return (
    <main className="mx-auto max-w-5xl p-6">
      <Breadcrumbs
        crumbs={[
          { label: "Sites", href: "/admin/sites" },
          { label: site.name, href: `/admin/sites/${site.id}` },
          { label: "Briefs", href: `/admin/sites/${site.id}` },
          { label: brief.title },
        ]}
      />
      <BriefReviewClient
        siteId={site.id}
        siteName={site.name}
        siteBrandVoiceDefault={site.brand_voice}
        siteDesignDirectionDefault={site.design_direction}
        brief={brief}
        initialPages={pages}
      />
    </main>
  );
}
