"use client";

import { useState } from "react";
import Link from "next/link";
import { BarChart3Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { InsightsDashboardData } from "@/lib/insights/dashboard";
import { KPIRow } from "./KPIRow";
import { RecommendationsPanelPlaceholder } from "./RecommendationsPanelPlaceholder";
import { BestContentSection } from "./BestContentSection";
import { TrendChartSection } from "./TrendChartSection";
import { DashboardFooterTabs } from "./DashboardFooterTabs";
import { EmptyState } from "./common/EmptyState";

interface InsightsDashboardClientProps {
  data: InsightsDashboardData;
  companyId: string;
}

export function InsightsDashboardClient({
  data,
  companyId,
}: InsightsDashboardClientProps) {
  const [activePlatform, setActivePlatform] = useState<string>(
    data.activePlatform,
  );

  if (data.postCount90d === 0) {
    return (
      <EmptyState
        icon={<BarChart3Icon size={48} />}
        title="Insights starts learning after your first published post"
        description="Once you have a few posts, you'll see engagement metrics, best content highlights, and recommendations based on your audience."
        action={
          <Button asChild>
            <Link href="/company/social/posts/new">+ Create your first post</Link>
          </Button>
        }
        bullets={[
          "Engagement metrics across your platforms",
          "Best content highlights",
          "Recommendations based on your audience",
        ]}
        data-testid="empty-no-posts"
      />
    );
  }

  return (
    <div className="space-y-8" data-testid="insights-dashboard">
      {data.kpis && (
        <KPIRow kpis={data.kpis} availableMetrics={data.availableMetrics} />
      )}
      <RecommendationsPanelPlaceholder
        companyId={companyId}
        platform={activePlatform}
        postCount={data.postCount90d}
      />
      <BestContentSection
        bestPosts={data.bestPosts}
        underperformingPosts={data.underperformingPosts}
        heatmapData={data.heatmapData}
        availableMetrics={data.availableMetrics}
      />
      <TrendChartSection
        trendByPlatform={data.trendByPlatform}
        activePlatform={activePlatform}
        onPlatformChange={setActivePlatform}
      />
      <DashboardFooterTabs
        sourceComparison={data.sourceComparison}
        xMetrics={data.xMetrics}
        xConnected={data.xConnected}
        integrationHealth={data.platforms}
      />
    </div>
  );
}
