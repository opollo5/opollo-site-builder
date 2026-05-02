// Tiny SVG sparkline for the page detail panel + page browser hover.
// Server-renderable (no React state, no event handlers); render-on-the-
// page input is a small array of {value, classification, evaluated_at}.

import type { ScoreClassification } from "@/lib/optimiser/scoring/types";

export type SparklinePoint = {
  value: number;
  classification: ScoreClassification;
  evaluated_at: string;
};

const STROKE_BY_CLASS: Record<ScoreClassification, string> = {
  high_performer: "#10b981",
  optimisable: "#f59e0b",
  needs_attention: "#ef4444",
};

export function ScoreSparkline({
  points,
  width = 200,
  height = 48,
}: {
  points: SparklinePoint[];
  width?: number;
  height?: number;
}) {
  if (points.length === 0) {
    return (
      <div
        style={{ width, height }}
        className="flex items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground"
      >
        no history
      </div>
    );
  }
  const padding = 4;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const minScore = 0;
  const maxScore = 100;
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const path = points
    .map((p, i) => {
      const x = padding + i * stepX;
      const y =
        padding +
        innerH -
        ((p.value - minScore) / (maxScore - minScore)) * innerH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = points[points.length - 1];
  const lastX = padding + (points.length - 1) * stepX;
  const lastY =
    padding +
    innerH -
    ((last.value - minScore) / (maxScore - minScore)) * innerH;
  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={`Score sparkline, latest ${last.value}`}
    >
      <line
        x1={padding}
        x2={width - padding}
        y1={padding + innerH * 0.2}
        y2={padding + innerH * 0.2}
        stroke="#10b98140"
        strokeDasharray="2 3"
      />
      <line
        x1={padding}
        x2={width - padding}
        y1={padding + innerH * 0.4}
        y2={padding + innerH * 0.4}
        stroke="#f59e0b40"
        strokeDasharray="2 3"
      />
      <path
        d={path}
        fill="none"
        stroke={STROKE_BY_CLASS[last.classification]}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={lastX}
        cy={lastY}
        r={3}
        fill={STROKE_BY_CLASS[last.classification]}
      />
    </svg>
  );
}
