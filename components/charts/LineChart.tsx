'use client';

import ReactECharts from 'echarts-for-react';
import { useChartTheme } from '@/lib/charts/theme';

export interface LineChartDataPoint {
  x: string | number;
  y: number;
  series?: string;
}

export interface LineChartProps {
  data: LineChartDataPoint[];
  xAxisLabel?: string;
  yAxisLabel?: string;
  yAxisFormatter?: (v: number) => string;
  smooth?: boolean;
  showLegend?: boolean;
  height?: number;
  ariaLabel: string;
}

interface SeriesGroup {
  name: string;
  idx: number;
  points: Array<[string | number, number]>;
}

function groupBySeries(data: LineChartDataPoint[]): SeriesGroup[] {
  const map = new Map<string, SeriesGroup>();
  data.forEach(({ x, y, series = 'default' }) => {
    if (!map.has(series)) {
      map.set(series, { name: series, idx: map.size, points: [] });
    }
    map.get(series)!.points.push([x, y]);
  });
  return Array.from(map.values());
}

export function LineChart({
  data,
  yAxisFormatter,
  smooth = true,
  showLegend = false,
  height = 300,
  ariaLabel,
}: LineChartProps) {
  const theme = useChartTheme();
  const groups = groupBySeries(data);

  const series = groups.map(group => ({
    name: group.name,
    type: 'line' as const,
    smooth,
    showSymbol: false,
    lineStyle: { width: 2, color: theme.seriesColors[group.idx % theme.seriesColors.length] },
    areaStyle: group.idx === 0 ? { color: theme.areaFill } : undefined,
    data: group.points,
  }));

  const option = {
    grid: { left: 50, right: 20, top: showLegend ? 40 : 30, bottom: 30 },
    xAxis: {
      type: 'time' as const,
      axisLabel: { color: theme.mutedText },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: {
        formatter: yAxisFormatter ?? ((v: number) => String(v)),
        color: theme.mutedText,
      },
      splitLine: { lineStyle: { color: theme.border, type: 'dashed' as const } },
    },
    tooltip: { trigger: 'axis' as const },
    legend: showLegend ? { top: 5 } : undefined,
    series,
  };

  return (
    <div style={{ height }} role="img" aria-label={ariaLabel}>
      <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge lazyUpdate />
    </div>
  );
}
