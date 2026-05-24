import { CardContent } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import type { InsightsDashboardData } from "@/lib/insights/dashboard";

const PLATFORM_LABEL: Record<string, string> = {
  linkedin_personal: "LinkedIn (Personal)",
  linkedin_company: "LinkedIn (Company)",
  facebook_page: "Facebook",
  x: "X",
  gbp: "Google Business",
  instagram_business: "Instagram",
};

interface IntegrationHealthListProps {
  platforms: InsightsDashboardData["platforms"];
}

export function IntegrationHealthList({ platforms }: IntegrationHealthListProps) {
  if (platforms.length === 0) {
    return (
      <CardContent className="pt-6">
        <p className="text-sm text-tx-muted">No connected platforms.</p>
      </CardContent>
    );
  }

  return (
    <CardContent className="pt-6" data-testid="integration-health-list">
      <div className="space-y-3">
        {platforms.map((p) => (
          <div
            key={p.platform}
            className="flex items-center justify-between"
            data-testid={`health-row-${p.platform}`}
          >
            <div>
              <div className="text-sm font-medium text-tx-primary">
                {PLATFORM_LABEL[p.platform] ?? p.platform}
              </div>
              <div className="text-sm text-tx-muted">
                {p.postCount30d} posts · last synced {p.lastIngestRelative}
              </div>
            </div>
            <StatusPill
              kind={
                p.healthStatus === "green"
                  ? "success"
                  : p.healthStatus === "amber"
                    ? "warning"
                    : "error"
              }
              label={p.connected ? "Connected" : "Disconnected"}
            />
          </div>
        ))}
      </div>
    </CardContent>
  );
}
