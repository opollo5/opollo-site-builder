import { notFound } from "next/navigation";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import { BriefRunClient } from "@/components/BriefRunClient";
import {
  estimateBriefRunCost,
  getBriefWithPages,
  type BriefRunSnapshot,
} from "@/lib/briefs";
import { getSite } from "@/lib/sites";
import { getServiceRoleClient } from "@/lib/supabase";

// /admin/sites/[id]/briefs/[brief_id]/run — M12-5 run surface.
//
// Server Component. Fetches:
//   - site (for breadcrumb + prefix)
//   - brief + brief_pages (for the page list + per-page preview)
//   - active brief_run row, if any (for status + cost rollup)
//   - pre-flight estimate (estimate_cents + page_count)
//   - tenant remaining monthly budget
//
// Hands everything to <BriefRunClient /> which owns the control buttons
// + polling / revalidation while a run is in flight.

export const dynamic = "force-dynamic";

export default async function BriefRunPage({
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
      <div
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
      >
        Failed to load site: {siteResult.error.message}
      </div>
    );
  }
  if (!briefResult.ok) {
    if (briefResult.error.code === "NOT_FOUND") notFound();
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
      >
        Failed to load brief: {briefResult.error.message}
      </div>
    );
  }

  if (briefResult.data.brief.site_id !== params.id) notFound();

  const site = siteResult.data.site;
  let { brief, pages } = briefResult.data;

  // Read-after-write race: the commit POST returns 200, client pushes
  // to /run, but the read here can hit a connection pool that hasn't
  // yet seen the COMMIT. Retry briefly when the brief looks "almost
  // committed" so the operator sees the run surface, not a misleading
  // "isn't committed yet" panel. Capped at ~1.5s total — beyond that,
  // it's a real not-committed brief and we fall through to the panel.
  if (brief.status === "parsed") {
    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const retry = await getBriefWithPages(params.brief_id);
      if (!retry.ok) break;
      if (retry.data.brief.status === "committed") {
        brief = retry.data.brief;
        pages = retry.data.pages;
        break;
      }
    }
  }

  if (brief.status !== "committed") {
    // The run surface is only meaningful once the brief is committed.
    // Bounce the operator back to the review surface where they can
    // commit.
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
        <div
          role="status"
          className="mt-6 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-yellow-900 dark:text-yellow-200"
        >
          <p className="font-medium">This brief isn&apos;t committed yet.</p>
          <p className="mt-1">
            <a
              className="underline hover:no-underline"
              href={`/admin/sites/${site.id}/briefs/${brief.id}/review`}
            >
              Review and commit
            </a>{" "}
            before starting a generation run.
          </p>
        </div>
      </main>
    );
  }

  const svc = getServiceRoleClient();
  const runRes = await svc
    .from("brief_runs")
    .select(
      "id, brief_id, status, current_ordinal, content_summary, run_cost_cents, failure_code, failure_detail, cancel_requested_at, started_at, finished_at, version_lock, created_at, updated_at",
    )
    .eq("brief_id", brief.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const activeRun = (runRes.data ?? null) as BriefRunSnapshot | null;

  const estimate = await estimateBriefRunCost(brief.id);

  const budget = await svc
    .from("tenant_cost_budgets")
    .select("monthly_cap_cents, monthly_usage_cents")
    .eq("site_id", site.id)
    .maybeSingle();
  const cap = Number(budget.data?.monthly_cap_cents ?? 0);
  const usage = Number(budget.data?.monthly_usage_cents ?? 0);
  const remainingBudgetCents = Math.max(0, cap - usage);

  return (
    <main className="mx-auto max-w-5xl p-6">
      <Breadcrumbs
        crumbs={[
          { label: "Sites", href: "/admin/sites" },
          { label: site.name, href: `/admin/sites/${site.id}` },
          { label: "Briefs", href: `/admin/sites/${site.id}` },
          { label: brief.title, href: `/admin/sites/${site.id}/briefs/${brief.id}/review` },
          { label: "Run" },
        ]}
      />
      <BriefRunClient
        siteId={site.id}
        siteName={site.name}
        brief={brief}
        pages={pages}
        activeRun={activeRun}
        estimateCents={estimate.ok ? estimate.estimate_cents : 0}
        remainingBudgetCents={remainingBudgetCents}
      />
    </main>
  );
}
