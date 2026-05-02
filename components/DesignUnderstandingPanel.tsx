"use client";

import { useState } from "react";

import { Textarea } from "@/components/ui/textarea";

interface View {
  swatches: string[];
  fonts: string[];
  layout_tags: string[];
  visual_tone_tags: string[];
  visual_tone: string;
}

interface Props {
  view: View;
  editedUnderstanding: string;
  onEditUnderstanding: (v: string) => void;
  confidence: "high" | "medium" | "low";
}

const CONFIDENCE_META: Record<
  Props["confidence"],
  { dotClass: string; label: string }
> = {
  high: {
    dotClass: "bg-success",
    label: "High confidence — multiple inputs aligned",
  },
  medium: {
    dotClass: "bg-warning",
    label: "Medium confidence — one strong input or mixed signals",
  },
  low: {
    dotClass: "bg-muted-foreground",
    label: "Low confidence — text only or no inputs yet",
  },
};

export function DesignUnderstandingPanel({
  view,
  editedUnderstanding,
  onEditUnderstanding,
  confidence,
}: Props) {
  const [showEditor, setShowEditor] = useState(false);
  const meta = CONFIDENCE_META[confidence];

  const tone = view.visual_tone_tags.join(", ") || view.visual_tone;
  const layout = view.layout_tags.join(", ") || "—";
  const typography =
    view.fonts.slice(0, 2).join(" + ") || "Default sans-serif";
  const density =
    view.layout_tags.includes("Dense data") ||
    view.layout_tags.includes("Card grid")
      ? "Medium-high information density"
      : "Comfortable whitespace";

  return (
    <div
      className="rounded-lg border bg-card p-4"
      data-testid="design-understanding-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Here&apos;s what we understood</h3>
        <span
          className="inline-flex items-center gap-1.5 text-sm"
          data-testid="dd-confidence"
          data-confidence={confidence}
        >
          <span
            aria-hidden
            className={`inline-block h-2 w-2 rounded-full ${meta.dotClass}`}
          />
          <span className="text-muted-foreground">{meta.label}</span>
        </span>
      </div>

      <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
        <div>
          <dt className="font-medium text-muted-foreground">Tone</dt>
          <dd>{tone}</dd>
        </div>
        <div>
          <dt className="font-medium text-muted-foreground">Layout</dt>
          <dd>{layout}</dd>
        </div>
        <div>
          <dt className="font-medium text-muted-foreground">Typography</dt>
          <dd>{typography}</dd>
        </div>
        <div>
          <dt className="font-medium text-muted-foreground">Density</dt>
          <dd>{density}</dd>
        </div>
        <div className="md:col-span-2">
          <dt className="font-medium text-muted-foreground">Colour direction</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {view.swatches.slice(0, 5).map((c, i) => (
              <span
                key={`${c}-${i}`}
                className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[10px]"
                title={c}
              >
                <span
                  className="inline-block h-3 w-3 rounded-sm border"
                  style={{ background: c }}
                  aria-hidden
                />
                <span className="font-mono">{c}</span>
              </span>
            ))}
            {view.swatches.length === 0 && <span className="text-muted-foreground">—</span>}
          </dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={() => setShowEditor((v) => !v)}
        className="mt-3 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
        aria-expanded={showEditor}
        data-testid="dd-edit-understanding-toggle"
      >
        {showEditor ? "Hide override" : "Edit understanding →"}
      </button>
      {showEditor && (
        <div className="mt-2">
          <Textarea
            placeholder="If we got it wrong, describe the design direction in your own words. We use this verbatim instead of the auto-extracted summary."
            value={editedUnderstanding}
            onChange={(e) => onEditUnderstanding(e.target.value)}
            maxLength={2000}
            rows={3}
            data-testid="dd-edit-understanding"
          />
        </div>
      )}
    </div>
  );
}
