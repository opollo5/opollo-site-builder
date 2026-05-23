"use client";

import ReactECharts from 'echarts-for-react';

import { PLATFORM_LABEL } from "@/lib/platform/social/variants/types";
import type { AnalyticsDashboard } from "@/lib/platform/social/analytics-ingest";

import { formatNumber } from "./format";
import { PLATFORM_COLOR } from "./platform-theme";

export function ImpressionsTimeSeries({
  dashboard,
}: {
  dashboard: AnalyticsDashboard;
}) {
  const platforms = dashboard.platforms.map((p) => p.platform);
  const dates = dashboard.time_series.map((point) => String(point.date).slice(5));

  const series = platforms.map((platform) => ({
    name: PLATFORM_LABEL[platform],
    type: 'line' as const,
    data: dashboard.time_series.map((point) => point.by_platform[platform] ?? 0),
    smooth: false,
    showSymbol: false,
    lineStyle: { width: 2, color: PLATFORM_COLOR[platform] },
    itemStyle: { color: PLATFORM_COLOR[platform] },
  }));

  const option = {
    grid: { left: 60, right: 20, top: 30, bottom: 30 },
    xAxis: {
      type: 'category' as const,
      data: dates,
      axisLabel: { color: '#6b7280', fontSize: 11 },
      splitLine: { show: false },
      boundaryGap: false,
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: {
        color: '#6b7280',
        fontSize: 11,
        formatter: (v: number) => formatNumber(v),
      },
      splitLine: { lineStyle: { color: '#e5e7eb', type: 'dashed' as const } },
    },
    tooltip: {
      trigger: 'axis' as const,
      formatter: (params: Array<{ seriesName: string; value: number }>) =>
        params.map(p => `${p.seriesName}: ${formatNumber(p.value)}`).join('<br/>'),
    },
    legend: {
      top: 5,
      right: 20,
      itemWidth: 14,
      textStyle: { fontSize: 12 },
      icon: 'circle',
    },
    series,
  };

  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm font-semibold">Impressions over time</div>
        <div className="text-sm text-muted-foreground">
          Last {dashboard.range_days} days · per platform
        </div>
      </div>
      <div style={{ width: "100%", height: 280 }} role="img" aria-label="Impressions over time per platform">
        <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge lazyUpdate />
      </div>
    </div>
  );
}
