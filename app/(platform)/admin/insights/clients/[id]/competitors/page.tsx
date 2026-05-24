import { redirect, notFound } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";

import { createRouteAuthClient } from "@/lib/auth";
import { getServiceRoleClient } from "@/lib/supabase";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { ApifyCostPanel } from "@/components/admin-insights/ApifyCostPanel";
import { CompetitorHistory } from "@/components/admin-insights/CompetitorHistory";
import { CompetitorsClient } from "./CompetitorsClient";
import type { Competitor } from "@/components/admin-insights/CompetitorList";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

async function getCompanyName(companyId: string): Promise<string | null> {
  const svc = getServiceRoleClient();
  const { data } = await svc
    .from("companies")
    .select("name")
    .eq("id", companyId)
    .maybeSingle();
  return data?.name ?? null;
}

async function getCompetitors(companyId: string): Promise<Competitor[]> {
  const svc = getServiceRoleClient();
  const { data } = await svc
    .from("ins_competitor_accounts")
    .select("id, platform, competitor_handle, competitor_display_name, created_at")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  return (data ?? []) as Competitor[];
}

export default async function CompetitorsPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createRouteAuthClient();
  const { data: isOp } = await supabase.rpc("is_cap_operator");
  if (!isOp) redirect("/admin");

  const [companyName, competitors] = await Promise.all([
    getCompanyName(params.id),
    getCompetitors(params.id),
  ]);

  if (!companyName) notFound();

  return (
    <PageShell>
      <PageHeader>
        <PageHeader.Breadcrumb
          segments={[
            { label: "Admin", href: "/admin" },
            { label: "Insights", href: "/admin/insights" },
            { label: companyName, href: `/admin/insights/clients/${params.id}` },
            { label: "Competitors" },
          ]}
        />
        <PageHeader.Title>Competitor tracking</PageHeader.Title>
        <PageHeader.Subtitle>
          Monitor competitors on LinkedIn and Facebook. Data is scraped daily via Apify.
        </PageHeader.Subtitle>
      </PageHeader>
      <PageShell.Content>
        <div className="space-y-8">
          <CompetitorsClient
            companyId={params.id}
            initialCompetitors={competitors}
          />
          <Suspense fallback={<div className="h-20 bg-b2 rounded-lg animate-pulse" />}>
            <ApifyCostPanel companyId={params.id} />
          </Suspense>
          <Suspense fallback={<div className="h-40 bg-b2 rounded-lg animate-pulse" />}>
            <CompetitorHistory companyId={params.id} />
          </Suspense>
          <div className="pt-4">
            <Link
              href={`/admin/insights/clients/${params.id}`}
              className="inline-flex items-center gap-1 text-sm text-tx-muted hover:text-tx-primary"
            >
              <ChevronLeftIcon size={20} />
              Back to client insights
            </Link>
          </div>
        </div>
      </PageShell.Content>
    </PageShell>
  );
}
