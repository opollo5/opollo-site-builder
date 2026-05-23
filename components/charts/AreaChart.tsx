'use client';

import ReactECharts from 'echarts-for-react';
import { useChartTheme } from '@/lib/charts/theme';

export interface AreaChartDataPoint {
  x: string | number;
  y: number;
}

export interface AreaChartProps {
  data: AreaChartDataPoint[];
  xAxisFormatter?: (v: string) => string;
  yAxisFormatter?: (v: number) => string;
  height?: number;
  ariaLabel: string;
}

export function AreaChart({
  data,
  xAxisFormatter,
  yAxisFormatter,
  height = 200,
  ariaLabel,
}: AreaChartProps) {
  const theme = useChartTheme();

  const option = {
    grid: { left: 40, right: 20, top: 20, bottom: 30 },
    xAxis: {
      type: 'category' as const,
      data: data.map(d => d.x),
      axisLabel: {
        color: theme.mutedText,
        formatter: xAxisFormatter,
        interval: Math.floor(data.length / 5),
      },
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
    series: [{
      type: 'line' as const,
      data: data.map(d => d.y),
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 2, color: theme.seriesColors[0] },
      areaStyle: { color: theme.areaFill },
      name: 'Published',
    }],
  };

  return (
    <div style={{ height }} role="img" aria-label={ariaLabel}>
      <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge lazyUpdate />
    </div>
  );
}
