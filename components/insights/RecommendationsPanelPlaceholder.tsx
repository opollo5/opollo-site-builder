import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "./common/EmptyState";

interface RecommendationsPanelPlaceholderProps {
  companyId: string;
  platform: string;
  postCount: number;
}

const MIN_POSTS_FOR_RECOMMENDATIONS = 20;

export function RecommendationsPanelPlaceholder({
  platform,
  postCount,
}: RecommendationsPanelPlaceholderProps) {
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
      <CardContent>
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
            action={
              <Button asChild>
                <Link href="/company/social/posts/new">+ Create a post</Link>
              </Button>
            }
            data-testid="recs-empty-need-more"
          />
        ) : (
          <EmptyState
            title="Recommendations coming soon"
            description="Recommendation generation is being built. Check back shortly."
            data-testid="recs-empty-placeholder"
          />
        )}
      </CardContent>
    </Card>
  );
}
