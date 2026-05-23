"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PillSelect, type PillSelectOption } from "@/components/ui/pill-select";
import { LineChart } from "@/components/charts/LineChart";
import { EmptyState } from "./common/EmptyState";

const PLATFORM_LABEL: Record<string, string> = {
  linkedin_personal: "LinkedIn (Personal)",
  linkedin_company: "LinkedIn (Company)",
  facebook_page: "Facebook",
  x: "X",
  gbp: "Google Business",
  instagram_business: "Instagram",
};

interface TrendChartSectionProps {
  trendByPlatform: Record<string, Array<{ date: string; engagementRate: number }>>;
  activePlatform: string;
  onPlatformChange: (platform: string) => void;
}

export function TrendChartSection({
  trendByPlatform,
  activePlatform,
  onPlatformChange,
}: TrendChartSectionProps) {
  const platforms = Object.keys(trendByPlatform);
  const currentData = trendByPlatform[activePlatform] ?? [];

  const platformOptions: PillSelectOption[] = platforms.map((p) => ({
    value: p,
    label: PLATFORM_LABEL[p] ?? p,
  }));

  const chartData = currentData.map((d) => ({
    x: d.date,
    y: d.engagementRate,
  }));

  return (
    <Card className="border-b2" data-testid="trend-chart-section">
      <CardHeader>
        <div className="flex items-center justify-between">
          <h2 className="text-section-title text-tx-primary">Engagement over time</h2>
          {platformOptions.length > 0 && (
            <PillSelect
              options={platformOptions}
              value={activePlatform}
              onValueChange={onPlatformChange}
            />
          )}
        </div>
      </CardHeader>
      <CardContent>
        {chartData.length > 0 ? (
          <LineChart
            data={chartData}
            ariaLabel={`Engagement trend for ${PLATFORM_LABEL[activePlatform] ?? activePlatform}`}
            height={280}
          />
        ) : (
          <EmptyState
            title={`No trend data for ${PLATFORM_LABEL[activePlatform] ?? activePlatform}`}
            description={
              platforms.length === 0
                ? "Connect a platform to see engagement trends."
                : "Try selecting a different platform."
            }
            data-testid="trend-empty"
          />
        )}
      </CardContent>
    </Card>
  );
}
