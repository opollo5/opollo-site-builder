import type { GapAnalysisResult } from "@/lib/insights/gap-analysis";

interface EngagementBenchmarkCardProps {
  engagementBenchmark: GapAnalysisResult["engagementBenchmark"];
}

export function EngagementBenchmarkCard({ engagementBenchmark }: EngagementBenchmarkCardProps) {
  const { yourRate, competitorMedian, deltaPercent } = engagementBenchmark;

  if (yourRate === 0 && competitorMedian === 0) return null;

  const aboveCompetitors = deltaPercent >= 0;
  const deltaAbs = Math.abs(deltaPercent);

  return (
    <div
      className="rounded-lg border border-b2 bg-b1 p-4 space-y-3"
      data-testid="engagement-benchmark-card"
    >
      <h3 className="text-sm font-semibold text-tx-primary">Engagement benchmark</h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-sm text-tx-muted">Your median rate</p>
          <p className="text-xl font-bold text-tx-primary">
            {(yourRate * 100).toFixed(2)}%
          </p>
        </div>
        {competitorMedian > 0 && (
          <div>
            <p className="text-sm text-tx-muted">Competitor median</p>
            <p className="text-xl font-bold text-tx-primary">
              {(competitorMedian * 100).toFixed(2)}%
            </p>
          </div>
        )}
      </div>
      {competitorMedian > 0 && (
        <p
          className={`text-sm font-medium ${aboveCompetitors ? "text-gr-600" : "text-rd-500"}`}
        >
          {aboveCompetitors
            ? `You outperform competitors by ${deltaAbs.toFixed(0)}%.`
            : `Competitors outperform you by ${deltaAbs.toFixed(0)}%.`}
        </p>
      )}
    </div>
  );
}
