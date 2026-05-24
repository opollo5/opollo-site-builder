import { CardContent } from "@/components/ui/card";
import type { InsightsDashboardData } from "@/lib/insights/dashboard";

interface SourceComparisonProps {
  data: InsightsDashboardData["sourceComparison"];
}

export function SourceComparison({ data }: SourceComparisonProps) {
  if (!data) {
    return (
      <CardContent className="pt-6">
        <p className="text-sm text-tx-muted">
          Source comparison data is not yet available. Publish posts via CAP
          and the Composer to see a comparison.
        </p>
      </CardContent>
    );
  }

  const { cap, composer } = data;
  const total = cap.count + composer.count;
  const capPct = total > 0 ? Math.round((cap.count / total) * 100) : 0;
  const composerPct = 100 - capPct;

  const capBetter =
    cap.avgEngagementRate > 0 && composer.avgEngagementRate > 0
      ? cap.avgEngagementRate > composer.avgEngagementRate
      : null;
  const diffPct =
    capBetter !== null && composer.avgEngagementRate > 0
      ? Math.round(
          (Math.abs(cap.avgEngagementRate - composer.avgEngagementRate) /
            composer.avgEngagementRate) *
            100,
        )
      : null;

  return (
    <CardContent className="pt-6" data-testid="source-comparison">
      <h3 className="mb-4 text-subsection text-tx-primary">
        Where is your best content coming from?
      </h3>
      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="mb-1 text-sm uppercase text-tx-muted">CAP</div>
          <div className="text-2xl font-semibold tabular-nums text-tx-primary">
            {cap.count} posts
          </div>
          <div className="text-sm text-tx-muted">
            avg {(cap.avgEngagementRate * 100).toFixed(1)}% · {capPct}% of total
          </div>
        </div>
        <div>
          <div className="mb-1 text-sm uppercase text-tx-muted">Composer</div>
          <div className="text-2xl font-semibold tabular-nums text-tx-primary">
            {composer.count} posts
          </div>
          <div className="text-sm text-tx-muted">
            avg {(composer.avgEngagementRate * 100).toFixed(1)}% · {composerPct}% of total
          </div>
        </div>
      </div>
      {capBetter !== null && diffPct !== null && (
        <p className="mt-4 text-sm font-medium text-tx-primary">
          {capBetter ? "CAP" : "Composer"} outperforms by {diffPct}%
        </p>
      )}
    </CardContent>
  );
}
