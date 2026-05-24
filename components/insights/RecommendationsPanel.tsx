"use client";

import { useEffect, useState } from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "./common/EmptyState";
import { RecommendationCard } from "./RecommendationCard";

interface Recommendation {
  id: string;
  recommendation_type: string;
  headline: string;
  body: string;
  confidence_band: "strong" | "moderate";
  confidence_score: number;
}

interface RecommendationsPanelProps {
  companyId: string;
  platform: string;
  postCount: number;
}

const MIN_POSTS_FOR_RECOMMENDATIONS = 20;

export function RecommendationsPanel({
  companyId,
  platform,
  postCount,
}: RecommendationsPanelProps) {
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (postCount < MIN_POSTS_FOR_RECOMMENDATIONS) return;
    setLoading(true);
    const params = new URLSearchParams({
      company_id: companyId,
      platform,
      limit: "5",
    });
    fetch(`/api/insights/recommendations?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setRecs(d.recommendations ?? []);
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        setLoaded(true);
      });
  }, [companyId, platform, postCount]);

  function handleDismissed(id: string) {
    setRecs((prev) => prev.filter((r) => r.id !== id));
  }

  const remaining = MIN_POSTS_FOR_RECOMMENDATIONS - postCount;

  return (
    <Card className="border-b2" data-testid="recommendations-panel">
      <CardHeader className="pb-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-section-title text-tx-primary">
            What we&apos;ve learned about your audience
          </h2>
          <span className="text-sm text-tx-muted">
            Tracking {postCount} {platform} posts (last 90 days)
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {postCount === 0 ? (
          <EmptyState
            title="Still learning"
            description="We'll surface recommendations as you publish more posts."
            data-testid="recs-empty-no-posts"
          />
        ) : remaining > 0 ? (
          <EmptyState
            title={`Need ${remaining} more posts`}
            description="Insights gets sharper with every post. Recommendations unlock at 20 posts."
            data-testid="recs-empty-need-more"
          />
        ) : loading ? (
          <div className="space-y-3" data-testid="recs-loading">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-lg bg-m2" />
            ))}
          </div>
        ) : loaded && recs.length === 0 ? (
          <EmptyState
            title="No recommendations yet"
            description="Your first recommendations will appear after the next analysis run."
            data-testid="recs-empty-none"
          />
        ) : (
          recs.map((rec) => (
            <RecommendationCard
              key={rec.id}
              rec={rec}
              companyId={companyId}
              onDismissed={handleDismissed}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}
