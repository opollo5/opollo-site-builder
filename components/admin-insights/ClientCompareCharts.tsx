"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { CompareDataPoint } from "@/lib/insights/admin-dashboard";
import { Sparkline } from "./Sparkline";

interface ClientCompareChartsProps {
  data: CompareDataPoint[];
}

function fmt(n: number | null): string {
  if (n === null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

export function ClientCompareCharts({ data }: ClientCompareChartsProps) {
  return (
    <Card className="border-b2" data-testid="client-compare-charts">
      <CardHeader className="pb-3">
        <h2 className="text-section-title text-tx-primary">30-day engagement comparison</h2>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.map((d) => (
            <div key={d.companyId} className="border border-b2 rounded-lg p-4">
              <div className="font-semibold text-tx-primary mb-1">{d.name}</div>
              <div className="text-2xl font-semibold tabular-nums text-pk mb-2">
                {fmt(d.avgEngagementRate30d)}
              </div>
              <Sparkline data={d.trendData30d} width={120} height={32} />
              <div className="text-sm text-tx-muted mt-2">{d.postCount30d} posts</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
