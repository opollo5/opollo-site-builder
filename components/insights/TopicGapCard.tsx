import type { GapAnalysisResult } from "@/lib/insights/gap-analysis";

interface TopicGapCardProps {
  topicGap: GapAnalysisResult["topicGap"];
}

export function TopicGapCard({ topicGap }: TopicGapCardProps) {
  if (topicGap.yourTopics.length === 0 && topicGap.competitorTopics.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-b2 bg-b1 p-4 space-y-3" data-testid="topic-gap-card">
      <h3 className="text-sm font-semibold text-tx-primary">Topic coverage</h3>
      {topicGap.missing.length > 0 && (
        <div>
          <p className="text-sm text-tx-muted mb-2">
            Topics competitors cover that you have not addressed:
          </p>
          <div className="flex flex-wrap gap-2">
            {topicGap.missing.map((topic) => (
              <span
                key={topic}
                className="rounded-full bg-am-100 text-am-700 px-2.5 py-0.5 text-sm font-medium"
              >
                {topic}
              </span>
            ))}
          </div>
        </div>
      )}
      {topicGap.yourTopics.length > 0 && (
        <div>
          <p className="text-sm text-tx-muted mb-2">Your top topics:</p>
          <div className="flex flex-wrap gap-2">
            {topicGap.yourTopics.slice(0, 5).map(({ topic, count }) => (
              <span
                key={topic}
                className="rounded-full bg-gr-100 text-gr-700 px-2.5 py-0.5 text-sm font-medium"
              >
                {topic} ({count})
              </span>
            ))}
          </div>
        </div>
      )}
      {topicGap.missing.length === 0 && topicGap.competitorTopics.length === 0 && (
        <p className="text-sm text-tx-muted">
          Competitor topic data not yet extracted. Check back after the next scrape.
        </p>
      )}
    </div>
  );
}
