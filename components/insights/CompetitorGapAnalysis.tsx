import { computeGapAnalysis } from "@/lib/insights/gap-analysis";
import { TopicGapCard } from "./TopicGapCard";
import { FormatGapCard } from "./FormatGapCard";
import { CadenceGapCard } from "./CadenceGapCard";
import { EngagementBenchmarkCard } from "./EngagementBenchmarkCard";

interface CompetitorGapAnalysisProps {
  companyId: string;
  platform?: string;
}

export async function CompetitorGapAnalysis({
  companyId,
  platform = "LINKEDIN",
}: CompetitorGapAnalysisProps) {
  const result = await computeGapAnalysis(companyId, platform);

  if (!result) return null;

  const hasAnyData =
    result.topicGap.yourTopics.length > 0 ||
    result.topicGap.missing.length > 0 ||
    result.cadenceGap.yourPostsPerMonth > 0 ||
    result.cadenceGap.competitorAvgPostsPerMonth > 0 ||
    result.engagementBenchmark.yourRate > 0 ||
    result.engagementBenchmark.competitorMedian > 0;

  if (!hasAnyData) return null;

  return (
    <section className="space-y-4" data-testid="competitor-gap-analysis">
      <h2 className="text-base font-semibold text-tx-primary">Competitor gap analysis</h2>
      <p className="text-sm text-tx-muted">
        How your content strategy compares to tracked competitors.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <TopicGapCard topicGap={result.topicGap} />
        <FormatGapCard formatGap={result.formatGap} />
        <CadenceGapCard cadenceGap={result.cadenceGap} />
        <EngagementBenchmarkCard engagementBenchmark={result.engagementBenchmark} />
      </div>
    </section>
  );
}
