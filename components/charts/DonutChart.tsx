'use client';

import ReactECharts from 'echarts-for-react';
import { useChartTheme } from '@/lib/charts/theme';

export interface DonutChartDataPoint {
  name: string;
  value: number;
  color?: string;
}

export interface DonutChartProps {
  data: DonutChartDataPoint[];
  height?: number;
  ariaLabel: string;
}

export function DonutChart({ data, height = 200, ariaLabel }: DonutChartProps) {
  const theme = useChartTheme();

  const option = {
    tooltip: { trigger: 'item' as const },
    series: [{
      type: 'pie' as const,
      radius: ['45%', '75%'],
      center: ['50%', '50%'],
      padAngle: 2,
      data: data.map((d, i) => ({
        name: d.name,
        value: d.value,
        itemStyle: { color: d.color ?? theme.seriesColors[i % theme.seriesColors.length] },
      })),
      label: { show: false },
    }],
  };

  return (
    <div style={{ height }} role="img" aria-label={ariaLabel}>
      <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge lazyUpdate />
    </div>
  );
}
