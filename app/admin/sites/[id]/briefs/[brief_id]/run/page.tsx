import { notFound } from "next/navigation";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import { BriefCommitWaiter } from "@/components/BriefCommitWaiter";
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
  // "isn't committed yet" panel. UAT (2026-05-03 round-3): bumped from
  // 3 × 500ms (1.5s) to 8 × 500ms (4s) because PostgREST pool
  // propagation occasionally takes >2s under load and operators were
  // still hitting the panel.
  if (brief.status === "parsed") {
    for (let attempt = 0; attempt < 8; attempt++) {
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
    // UAT (2026-05-03 round-3): replaced the static "isn't committed
    // yet" panel with a client-side polling waiter. Even with the
    // server-side visibility wait in /api/briefs/[brief_id]/commit,
    // Vercel may route this server render to a different serverless
    // instance whose connection pool hasn't yet seen the COMMIT —
    // operators saw the panel for several seconds and were confused
    // because they had JUST clicked Commit. The waiter polls the
    // snapshot endpoint until status='committed' is visible (up to
    // 30s) and then router.refresh()'es into the run UI. The
    // exhaustion path falls through to a clearer "couldn't verify the
    // commit" message + back-to-review link, replacing the prior
    // panel's role.
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
        <BriefCommitWaiter
          briefId={brief.id}
          reviewUrl={`/admin/sites/${site.id}/briefs/${brief.id}/review`}
        />
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
        siteMode={site.site_mode}
        siteWpUrl={site.wp_url}
        brief={brief}
        pages={pages}
        activeRun={activeRun}
        estimateCents={estimate.ok ? estimate.estimate_cents : 0}
        remainingBudgetCents={remainingBudgetCents}
      />
    </main>
  );
}
