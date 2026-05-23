import { getServiceRoleClient } from "@/lib/supabase";

interface CompetitorEntry {
  platform: string;
  competitor_handle: string;
  competitor_display_name: string | null;
}

async function fetchCompetitorData(
  companyId: string,
): Promise<{ consent: boolean; competitors: CompetitorEntry[] }> {
  const svc = getServiceRoleClient();
  const [consentRes, compRes] = await Promise.all([
    svc
      .from("ins_consent")
      .select("competitor_tracking_consent")
      .eq("company_id", companyId)
      .maybeSingle(),
    svc
      .from("ins_competitor_accounts")
      .select("platform, competitor_handle, competitor_display_name")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("platform"),
  ]);

  const consent = consentRes.data?.competitor_tracking_consent === true;
  return { consent, competitors: (compRes.data ?? []) as CompetitorEntry[] };
}

export async function CompetitorVisibility({ companyId }: { companyId: string }) {
  const { consent, competitors } = await fetchCompetitorData(companyId);

  if (!consent) return null;

  if (competitors.length === 0) {
    return (
      <section className="space-y-3" data-testid="competitor-visibility">
        <h2 className="text-base font-semibold text-tx-primary">Competitor tracking</h2>
        <p className="text-sm text-tx-muted">
          No competitors are currently being tracked for your account.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3" data-testid="competitor-visibility">
      <h2 className="text-base font-semibold text-tx-primary">Competitor tracking</h2>
      <p className="text-sm text-tx-muted">
        The following competitors are being monitored to help contextualise your performance.
      </p>
      <ul className="space-y-2">
        {competitors.map((c) => (
          <li
            key={`${c.platform}-${c.competitor_handle}`}
            className="flex items-center gap-2 text-sm text-tx-primary"
          >
            <span className="font-medium">{c.competitor_display_name ?? c.competitor_handle}</span>
            <span className="text-tx-muted">({c.platform})</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
