'use client';

export interface ChartTheme {
  seriesColors: string[];
  areaFill: string;
  mutedText: string;
  border: string;
}

// Static theme derived from Opollo CSS tokens.
// Uses CSS custom properties so colors inherit from the active theme.
export function useChartTheme(): ChartTheme {
  return {
    seriesColors: [
      'hsl(var(--primary))',
      'hsl(211 100% 56%)',
      '#d97706',
      '#059669',
      '#dc2626',
    ],
    areaFill: 'hsl(var(--primary) / 0.1)',
    mutedText: '#64748b',
    border: '#e2e8f0',
  };
}
