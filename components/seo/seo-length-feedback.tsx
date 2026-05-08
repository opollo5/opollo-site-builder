"use client";

import type { LengthFeedback } from "@/lib/seo/length-feedback";
import { cn } from "@/lib/utils";

// Spec 11 — visual progress bar + qualifying-language hint pair.
//
// Renders directly under the SEO title or meta description input. The
// brief asks for a 4px bar plus the heuristic label; this component
// owns that layout. Colour map:
//   • red    → bg-red-500
//   • orange → bg-amber-500
//   • green  → bg-emerald-500
// (Tailwind tokens; kept inline rather than wired through brand vars
// because Yoast/serp readability conventions are colour-specific.)

interface Props {
  feedback: LengthFeedback;
  /** Current character count — shown after the qualifying label as e.g. "55 chars · typically good". */
  length: number;
}

const COLOR_BAR: Record<LengthFeedback["color"], string> = {
  red: "bg-red-500",
  orange: "bg-amber-500",
  green: "bg-emerald-500",
};

const COLOR_TEXT: Record<LengthFeedback["color"], string> = {
  red: "text-red-600 dark:text-red-400",
  orange: "text-amber-700 dark:text-amber-400",
  green: "text-emerald-700 dark:text-emerald-400",
};

export function SeoLengthFeedback({ feedback, length }: Props) {
  return (
    <div className="mt-1.5">
      <div
        className="h-1 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={feedback.percentage}
        aria-label={`SEO length: ${feedback.label}`}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-150",
            COLOR_BAR[feedback.color],
          )}
          style={{ width: `${feedback.percentage}%` }}
        />
      </div>
      <p className={cn("mt-1 text-xs", COLOR_TEXT[feedback.color])}>
        {length} char{length === 1 ? "" : "s"} · {feedback.label}
      </p>
    </div>
  );
}
