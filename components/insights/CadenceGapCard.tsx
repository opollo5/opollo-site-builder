import type { GapAnalysisResult } from "@/lib/insights/gap-analysis";

interface CadenceGapCardProps {
  cadenceGap: GapAnalysisResult["cadenceGap"];
}

export function CadenceGapCard({ cadenceGap }: CadenceGapCardProps) {
  if (cadenceGap.yourPostsPerMonth === 0 && cadenceGap.competitorAvgPostsPerMonth === 0) {
    return null;
  }

  const delta = cadenceGap.competitorAvgPostsPerMonth - cadenceGap.yourPostsPerMonth;
  const behind = delta > 0;

  return (
    <div className="rounded-lg border border-b2 bg-b1 p-4 space-y-3" data-testid="cadence-gap-card">
      <h3 className="text-sm font-semibold text-tx-primary">Posting cadence</h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-sm text-tx-muted">Your posts / month</p>
          <p className="text-xl font-bold text-tx-primary">{cadenceGap.yourPostsPerMonth}</p>
        </div>
        <div>
          <p className="text-sm text-tx-muted">Competitor avg / month</p>
          <p className="text-xl font-bold text-tx-primary">{cadenceGap.competitorAvgPostsPerMonth}</p>
        </div>
      </div>
      {behind && delta >= 2 && (
        <p className="text-sm text-am-700">
          Competitors post {delta} more times per month on average. Consider increasing cadence.
        </p>
      )}
      {!behind && (
        <p className="text-sm text-gr-600">
          Your posting cadence matches or exceeds competitors.
        </p>
      )}
    </div>
  );
}
