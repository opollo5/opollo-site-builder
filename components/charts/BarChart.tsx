'use client';

import ReactECharts from 'echarts-for-react';
import { useChartTheme } from '@/lib/charts/theme';

export interface BarChartDataPoint {
  label: string;
  value: number;
  color?: string;
}

export interface BarChartProps {
  data: BarChartDataPoint[];
  layout?: 'vertical' | 'horizontal';
  yAxisFormatter?: (v: number) => string;
  height?: number;
  ariaLabel: string;
}

export function BarChart({
  data,
  layout = 'vertical',
  yAxisFormatter,
  height = 260,
  ariaLabel,
}: BarChartProps) {
  const theme = useChartTheme();

  const labels = data.map(d => d.label);
  const values = data.map(d => d.value);
  const colors = data.map((d, i) => d.color ?? theme.seriesColors[i % theme.seriesColors.length]);

  const isHorizontal = layout === 'horizontal';

  const option = isHorizontal
    ? {
        grid: { left: 130, right: 20, top: 10, bottom: 30 },
        xAxis: {
          type: 'value' as const,
          axisLabel: {
            formatter: yAxisFormatter ?? ((v: number) => String(v)),
            color: theme.mutedText,
          },
          splitLine: { lineStyle: { color: theme.border, type: 'dashed' as const } },
        },
        yAxis: {
          type: 'category' as const,
          data: labels,
          axisLabel: { color: theme.mutedText },
          splitLine: { show: false },
        },
        tooltip: { trigger: 'axis' as const },
        series: [{
          type: 'bar' as const,
          data: values.map((v, i) => ({ value: v, itemStyle: { color: colors[i] } })),
          barMaxWidth: 32,
        }],
      }
    : {
        grid: { left: 50, right: 20, top: 10, bottom: 50 },
        xAxis: {
          type: 'category' as const,
          data: labels,
          axisLabel: { color: theme.mutedText, rotate: labels.some(l => l.length > 8) ? 30 : 0 },
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
          type: 'bar' as const,
          data: values.map((v, i) => ({ value: v, itemStyle: { color: colors[i] } })),
          barMaxWidth: 48,
          itemStyle: { borderRadius: [3, 3, 0, 0] },
        }],
      };

  return (
    <div style={{ height }} role="img" aria-label={ariaLabel}>
      <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge lazyUpdate />
    </div>
  );
}
