"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PLATFORM_LABEL } from "@/lib/platform/social/variants/types";
import type { AnalyticsDashboard } from "@/lib/platform/social/analytics-ingest";

import { formatNumber } from "./format";
import { PLATFORM_COLOR } from "./platform-theme";

export function ImpressionsTimeSeries({
  dashboard,
}: {
  dashboard: AnalyticsDashboard;
}) {
  // Recharts wants a flat row per x-tick. Flatten by_platform → top-level
  // platform keys so each platform gets its own <Line dataKey>.
  const data = dashboard.time_series.map((point) => {
    const row: Record<string, string | number> = {
      date: point.date,
      total: point.total,
    };
    for (const [platform, value] of Object.entries(point.by_platform)) {
      row[platform] = value;
    }
    return row;
  });

  const platforms = dashboard.platforms.map((p) => p.platform);

  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm font-semibold">Impressions over time</div>
        <div className="text-xs text-muted-foreground">
          Last {dashboard.range_days} days · per platform
        </div>
      </div>
      <div style={{ width: "100%", height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 20, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "#6b7280" }}
              tickFormatter={(d) => String(d).slice(5)}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#6b7280" }}
              tickFormatter={(v) => formatNumber(Number(v))}
              width={48}
            />
            <Tooltip
              contentStyle={{
                fontSize: 12,
                borderRadius: 6,
                border: "1px solid #e5e7eb",
              }}
              formatter={(value) => formatNumber(Number(value))}
              labelFormatter={(label) => String(label)}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              iconType="circle"
            />
            {platforms.map((platform) => (
              <Line
                key={platform}
                type="monotone"
                dataKey={platform}
                stroke={PLATFORM_COLOR[platform]}
                strokeWidth={2}
                dot={false}
                name={PLATFORM_LABEL[platform]}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
