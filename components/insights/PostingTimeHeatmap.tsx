"use client";

import { HeatmapChart, type HeatmapChartDataPoint } from "@/components/charts/HeatmapChart";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface HeatmapPoint {
  dayOfWeek: number;
  hour: number;
  engagementRate: number;
  postCount: number;
}

interface PostingTimeHeatmapProps {
  data: HeatmapPoint[];
}

export function PostingTimeHeatmap({ data }: PostingTimeHeatmapProps) {
  const heatmapData: HeatmapChartDataPoint[] = data.map((d) => ({
    x: d.hour,
    y: d.dayOfWeek,
    value: d.postCount,
  }));

  return (
    <div data-testid="posting-heatmap">
      <HeatmapChart
        data={heatmapData}
        xLabels={Array.from({ length: 24 }, (_, i) => `${i}:00`)}
        yLabels={DAY_LABELS}
        ariaLabel="Posting time heatmap"
        height={200}
      />
    </div>
  );
}
