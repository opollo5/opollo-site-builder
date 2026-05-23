"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PillSelect, type PillSelectOption } from "@/components/ui/pill-select";
import { Tabs, TabTrigger } from "@/components/ui/tabs";
import type { BestPost, InsightsDashboardData } from "@/lib/insights/dashboard";
import { EmptyState } from "./common/EmptyState";
import { PostRow } from "./PostRow";
import { PostingTimeHeatmap } from "./PostingTimeHeatmap";

interface BestContentSectionProps {
  bestPosts: BestPost[];
  underperformingPosts: BestPost[];
  heatmapData: InsightsDashboardData["heatmapData"];
  availableMetrics: InsightsDashboardData["availableMetrics"];
}

type SortBy = "engagement_rate" | "impressions" | "comments" | "shares" | "time_of_day";
type ViewType = "best" | "underperforming";

const SORT_OPTIONS: PillSelectOption[] = [
  { value: "engagement_rate", label: "Engagement rate" },
  { value: "impressions", label: "Impressions" },
  { value: "comments", label: "Comments" },
  { value: "shares", label: "Shares" },
  { value: "time_of_day", label: "Time of day" },
];

function sortPosts(posts: BestPost[], sortBy: SortBy): BestPost[] {
  if (sortBy === "time_of_day" || sortBy === "engagement_rate") return posts;
  return [...posts].sort((a, b) => {
    if (sortBy === "impressions") return (b.impressions ?? 0) - (a.impressions ?? 0);
    if (sortBy === "comments") return (b.comments ?? 0) - (a.comments ?? 0);
    if (sortBy === "shares") return (b.shares ?? 0) - (a.shares ?? 0);
    return 0;
  });
}

export function BestContentSection({
  bestPosts,
  underperformingPosts,
  heatmapData,
  availableMetrics,
}: BestContentSectionProps) {
  const [view, setView] = useState<ViewType>("best");
  const [sortBy, setSortBy] = useState<SortBy>("engagement_rate");
  const [showAll, setShowAll] = useState(false);

  const posts = view === "best" ? bestPosts : underperformingPosts;
  const sorted = sortPosts(posts, sortBy);
  const displayed = showAll ? sorted : sorted.slice(0, 5);

  return (
    <Card className="border-b2" data-testid="best-content-section">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={view} onValueChange={(v) => setView(v as ViewType)}>
            <TabTrigger value="best">Best content</TabTrigger>
            <TabTrigger value="underperforming">Underperforming</TabTrigger>
          </Tabs>
          <PillSelect
            options={SORT_OPTIONS}
            value={sortBy}
            onValueChange={(v) => setSortBy(v as SortBy)}
            placeholder="Sort by"
          />
        </div>
        {view === "underperforming" && (
          <p className="mt-2 text-sm italic text-tx-muted">
            These posts performed below your recent median. That doesn&apos;t
            always mean the content was poor — it may reflect timing, audience
            availability, or limited reach.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {sortBy === "time_of_day" ? (
          heatmapData && heatmapData.length > 0 ? (
            <PostingTimeHeatmap data={heatmapData} />
          ) : (
            <EmptyState
              title="No posting time data yet"
              description="Time of day analysis requires more posts."
              data-testid="heatmap-empty"
            />
          )
        ) : displayed.length > 0 ? (
          <>
            {displayed.map((post) => (
              <PostRow key={post.id} post={post} availableMetrics={availableMetrics} />
            ))}
            {!showAll && sorted.length > 5 && (
              <Button
                variant="link"
                className="px-0"
                onClick={() => setShowAll(true)}
                data-testid="show-all-posts"
              >
                Show all {sorted.length} posts →
              </Button>
            )}
          </>
        ) : (
          <EmptyState
            title="No posts yet"
            description="Publish some posts to see your best and underperforming content."
            data-testid="posts-empty"
          />
        )}
      </CardContent>
    </Card>
  );
}
