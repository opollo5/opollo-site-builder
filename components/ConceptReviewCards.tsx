"use client";

import { useState } from "react";
import { Monitor, Smartphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ConceptError, ConceptResult } from "@/components/DesignDirectionInputs";

// ---------------------------------------------------------------------------
// ConceptReviewCards — PR 6 of DESIGN-DISCOVERY.
//
// Renders the three generated concepts side-by-side (stacked on
// mobile). Each card has:
//   - Label "Direction A — Minimal" etc.
//   - 1–2 line rationale
//   - Five-swatch palette + heading/body fonts
//   - Inline micro UI preview (button, card, input — NOT in an
//     iframe, so the host card's typography styles bleed through)
//   - Homepage iframe (sandboxed, srcdoc) with a desktop/mobile
//     toggle and a homepage/inner-page toggle.
//   - "Select this direction" CTA — PR 7 wires the refinement +
//     approve flow to the onSelect callback.
//
// A separate before/after panel appears below the cards when the
// operator provided a reference / existing-site URL: side-by-side
// the Microlink screenshot + the *currently selected* concept's
// homepage iframe.
// ---------------------------------------------------------------------------

const DIRECTION_TITLES: Record<ConceptResult["direction"], string> = {
  minimal: "Direction A — Minimal",
  dense: "Direction B — Conversion",
  editorial: "Direction C — Editorial",
};

const SWATCH_KEYS: Array<keyof ConceptResult["design_tokens"]> = [
  "primary",
  "secondary",
  "accent",
  "background",
  "text",
];

interface Props {
  concepts: ConceptResult[];
  errors: ConceptError[];
  referenceScreenshotUrl: string | null;
  onSelect?: (direction: ConceptResult["direction"]) => void;
}

export function ConceptReviewCards({
  concepts,
  errors,
  referenceScreenshotUrl,
  onSelect,
}: Props) {
  const [selected, setSelected] = useState<ConceptResult["direction"] | null>(
    null,
  );

  const selectedConcept =
    selected != null
      ? concepts.find((c) => c.direction === selected) ?? null
      : null;

  return (
    <div className="space-y-4" data-testid="concept-review-cards">
      <div className="grid gap-4 md:grid-cols-3">
        {concepts.map((c) => (
          <ConceptCard
            key={c.direction}
            concept={c}
            isSelected={selected === c.direction}
            onSelect={() => {
              setSelected(c.direction);
              onSelect?.(c.direction);
            }}
          />
        ))}
      </div>

      {errors.length > 0 && (
        <div
          className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-warning"
          role="alert"
          data-testid="concept-review-errors"
        >
          <p className="font-medium">
            {errors.length} of {errors.length + concepts.length} directions
            failed to generate.
          </p>
          <p className="mt-0.5">
            {errors.map((e) => e.label).join(", ")} — click &quot;Generate
            concepts&quot; again to retry.
          </p>
        </div>
      )}

      {referenceScreenshotUrl && selectedConcept && (
        <BeforeAfterPanel
          referenceUrl={referenceScreenshotUrl}
          concept={selectedConcept}
        />
      )}
    </div>
  );
}

function ConceptCard({
  concept,
  isSelected,
  onSelect,
}: {
  concept: ConceptResult;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const [view, setView] = useState<"desktop" | "mobile">("desktop");
  const [page, setPage] = useState<"homepage" | "inner">("homepage");

  const html = page === "homepage" ? concept.homepage_html : concept.inner_page_html;
  const iframeWidth = view === "mobile" ? "390px" : "100%";
  const iframeHeightClass =
    view === "mobile" ? "h-[640px]" : "h-[420px]";

  return (
    <article
      className={[
        "rounded-lg border bg-card p-4 transition-smooth",
        isSelected
          ? "border-foreground ring-2 ring-foreground/30"
          : "hover:border-foreground/40",
      ].join(" ")}
      data-testid={`concept-card-${concept.direction}`}
      data-selected={isSelected ? "true" : "false"}
    >
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {DIRECTION_TITLES[concept.direction]}
        </h3>
      </header>
      <p
        className="mt-1 text-sm text-muted-foreground"
        data-testid={`concept-rationale-${concept.direction}`}
      >
        {concept.rationale}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {SWATCH_KEYS.map((k) => (
          <span
            key={k}
            className="inline-flex items-center gap-1 rounded-md border bg-background px-1 py-0.5 text-[9px]"
            title={`${k}: ${concept.design_tokens[k]}`}
          >
            <span
              className="inline-block h-3 w-3 rounded-sm border"
              style={{ background: concept.design_tokens[k] }}
              aria-hidden
            />
            <span className="font-mono uppercase">{k}</span>
          </span>
        ))}
      </div>

      <p className="mt-2 text-[10px] text-muted-foreground">
        Heading:{" "}
        <span
          className="text-foreground"
          style={{ fontFamily: `${concept.design_tokens.font_heading}, system-ui, sans-serif` }}
        >
          {concept.design_tokens.font_heading}
        </span>{" "}
        · Body:{" "}
        <span
          className="text-foreground"
          style={{ fontFamily: `${concept.design_tokens.font_body}, system-ui, sans-serif` }}
        >
          {concept.design_tokens.font_body}
        </span>
      </p>

      <MicroUiPreview micro={concept.micro_ui} />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="inline-flex rounded-md border bg-background p-0.5">
          <button
            type="button"
            onClick={() => setView("desktop")}
            className={[
              "inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-[10px]",
              view === "desktop"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
            aria-pressed={view === "desktop"}
            data-testid={`concept-view-desktop-${concept.direction}`}
          >
            <Monitor aria-hidden className="h-3 w-3" />
            Desktop
          </button>
          <button
            type="button"
            onClick={() => setView("mobile")}
            className={[
              "inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-[10px]",
              view === "mobile"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
            aria-pressed={view === "mobile"}
            data-testid={`concept-view-mobile-${concept.direction}`}
          >
            <Smartphone aria-hidden className="h-3 w-3" />
            Mobile
          </button>
        </div>
        <button
          type="button"
          onClick={() => setPage(page === "homepage" ? "inner" : "homepage")}
          className="text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm"
          data-testid={`concept-toggle-page-${concept.direction}`}
        >
          {page === "homepage" ? "View inner page →" : "← View homepage"}
        </button>
      </div>

      <div
        className={`mt-2 overflow-hidden rounded-md border bg-muted/20 ${iframeHeightClass}`}
        data-testid={`concept-iframe-frame-${concept.direction}`}
      >
        <iframe
          title={`${DIRECTION_TITLES[concept.direction]} — ${page}`}
          srcDoc={html}
          sandbox=""
          className="block h-full"
          style={{ width: iframeWidth, margin: view === "mobile" ? "0 auto" : undefined }}
          data-testid={`concept-iframe-${concept.direction}`}
        />
      </div>

      <div className="mt-3 flex items-center justify-end">
        <Button
          type="button"
          size="sm"
          onClick={onSelect}
          variant={isSelected ? "default" : "outline"}
          data-testid={`concept-select-${concept.direction}`}
        >
          {isSelected ? "Selected" : "Select this direction"}
        </Button>
      </div>
    </article>
  );
}

function MicroUiPreview({ micro }: { micro: ConceptResult["micro_ui"] }) {
  return (
    <div className="mt-3 rounded-md border bg-muted/10 p-2">
      <p className="mb-1 text-[10px] font-medium text-muted-foreground">
        Micro UI
      </p>
      <div
        className="grid gap-1.5 text-[10px] text-foreground [&_*]:!max-w-full [&_*]:!box-border"
        data-testid="concept-micro-ui"
      >
        <div
          dangerouslySetInnerHTML={{ __html: micro.button }}
          className="overflow-hidden"
        />
        <div
          dangerouslySetInnerHTML={{ __html: micro.card }}
          className="overflow-hidden"
        />
        <div
          dangerouslySetInnerHTML={{ __html: micro.input }}
          className="overflow-hidden"
        />
      </div>
    </div>
  );
}

function BeforeAfterPanel({
  referenceUrl,
  concept,
}: {
  referenceUrl: string;
  concept: ConceptResult;
}) {
  return (
    <section
      className="rounded-lg border bg-card p-4"
      data-testid="concept-before-after"
    >
      <h3 className="text-sm font-semibold">Before vs after</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Your reference next to {DIRECTION_TITLES[concept.direction]}.
      </p>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-[10px] font-medium text-muted-foreground">
            Your reference
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={referenceUrl}
            alt="Reference site screenshot"
            className="mt-1 w-full rounded-md border object-cover"
            loading="lazy"
            data-testid="concept-before-image"
          />
        </div>
        <div>
          <p className="text-[10px] font-medium text-muted-foreground">
            Our interpretation
          </p>
          <div
            className="mt-1 h-72 overflow-hidden rounded-md border bg-muted/20"
            data-testid="concept-after-frame"
          >
            <iframe
              title={`${DIRECTION_TITLES[concept.direction]} — homepage`}
              srcDoc={concept.homepage_html}
              sandbox=""
              className="block h-full w-full"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
