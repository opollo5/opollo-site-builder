import { getServiceRoleClient } from "@/lib/supabase";

interface CostRow {
  cost_usd: number;
  created_at: string;
}

async function fetchApifyCosts(companyId: string): Promise<{ last7d: number; monthly: number }> {
  const svc = getServiceRoleClient();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [res7d, res30d] = await Promise.all([
    svc
      .from("ins_external_provider_costs")
      .select("cost_usd, created_at")
      .eq("company_id", companyId)
      .eq("provider", "apify")
      .gte("created_at", since7d),
    svc
      .from("ins_external_provider_costs")
      .select("cost_usd, created_at")
      .eq("company_id", companyId)
      .eq("provider", "apify")
      .gte("created_at", since30d),
  ]);

  const sum = (rows: CostRow[]) => rows.reduce((a, r) => a + Number(r.cost_usd), 0);
  const last7d = sum((res7d.data ?? []) as CostRow[]);
  const last30d = sum((res30d.data ?? []) as CostRow[]);
  const monthly = last7d > 0 ? (last7d / 7) * 30 : last30d;

  return { last7d, monthly };
}

export async function ApifyCostPanel({ companyId }: { companyId: string }) {
  const { last7d, monthly } = await fetchApifyCosts(companyId);

  if (last7d === 0 && monthly === 0) {
    return (
      <div className="rounded-lg border border-b2 bg-b1 px-4 py-3 text-sm text-tx-muted">
        No Apify cost data yet — scraping has not run or APIFY_TOKEN is not configured.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-b2 bg-b1 px-4 py-3" data-testid="apify-cost-panel">
      <h3 className="text-sm font-medium text-tx-primary mb-2">Apify scraping cost</h3>
      <dl className="grid grid-cols-2 gap-4">
        <div>
          <dt className="text-sm text-tx-muted">Last 7 days</dt>
          <dd className="text-sm font-semibold text-tx-primary">${last7d.toFixed(3)}</dd>
        </div>
        <div>
          <dt className="text-sm text-tx-muted">Monthly projection</dt>
          <dd className="text-sm font-semibold text-tx-primary">${monthly.toFixed(2)}</dd>
        </div>
      </dl>
    </div>
  );
}
