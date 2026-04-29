import type { ScoreClassification } from "./types";

// Composite-score classification per addendum §2.3.
//   80–100 → high_performer  (green)
//   60–79  → optimisable    (amber)
//    0–59  → needs_attention (red)

export function classify(score: number): ScoreClassification {
  if (score >= 80) return "high_performer";
  if (score >= 60) return "optimisable";
  return "needs_attention";
}

export function classificationLabel(c: ScoreClassification): string {
  switch (c) {
    case "high_performer":
      return "High performer";
    case "optimisable":
      return "Optimisable";
    case "needs_attention":
      return "Needs attention";
  }
}

export function classificationBadgeColor(c: ScoreClassification): {
  bg: string;
  border: string;
  text: string;
  dot: string;
} {
  switch (c) {
    case "high_performer":
      return {
        bg: "bg-emerald-100",
        border: "border-emerald-200",
        text: "text-emerald-900",
        dot: "bg-emerald-500",
      };
    case "optimisable":
      return {
        bg: "bg-amber-100",
        border: "border-amber-200",
        text: "text-amber-900",
        dot: "bg-amber-400",
      };
    case "needs_attention":
      return {
        bg: "bg-red-100",
        border: "border-red-200",
        text: "text-red-900",
        dot: "bg-red-500",
      };
  }
}
