'use client';

import ReactECharts from 'echarts-for-react';
import { useChartTheme } from '@/lib/charts/theme';

export interface HeatmapChartDataPoint {
  x: string | number;
  y: string | number;
  value: number;
}

export interface HeatmapChartProps {
  data: HeatmapChartDataPoint[];
  xLabels: string[];
  yLabels: string[];
  colorMin?: string;
  colorMax?: string;
  height?: number;
  ariaLabel: string;
}

export function HeatmapChart({
  data,
  xLabels,
  yLabels,
  colorMin,
  colorMax,
  height = 300,
  ariaLabel,
}: HeatmapChartProps) {
  const theme = useChartTheme();

  const option = {
    grid: { left: 60, right: 20, top: 30, bottom: 40 },
    xAxis: {
      type: 'category' as const,
      data: xLabels,
      axisLabel: { color: theme.mutedText },
      splitArea: { show: true },
    },
    yAxis: {
      type: 'category' as const,
      data: yLabels,
      axisLabel: { color: theme.mutedText },
      splitArea: { show: true },
    },
    visualMap: {
      min: 0,
      max: Math.max(...data.map(d => d.value), 1),
      calculable: true,
      orient: 'horizontal' as const,
      left: 'center',
      bottom: 0,
      inRange: {
        color: [colorMin ?? '#e0f2fe', colorMax ?? 'hsl(var(--primary))'],
      },
    },
    tooltip: { position: 'top' as const },
    series: [{
      type: 'heatmap' as const,
      data: data.map(d => [d.x, d.y, d.value]),
      emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.2)' } },
    }],
  };

  return (
    <div style={{ height }} role="img" aria-label={ariaLabel}>
      <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge lazyUpdate />
    </div>
  );
}
