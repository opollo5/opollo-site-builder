"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// BugReplayOverlay — renders a screenshot with the click marker at the
// stored percentage coordinates (click_x_pct / click_y_pct).
//
// §1 render fix: the image renders at its natural aspect ratio (w-full, no
// height constraint). This eliminates the object-contain letterboxing that
// previously caused the marker's left/top percentages to be measured against
// the container rather than the rendered image. The marker sits at exactly
// (clickXPct% width, clickYPct% height) of the image — correct.
//
// §3 lightbox: clicking the image opens a full-screen modal with the marker
// still positioned correctly. Esc and backdrop-click close it.
//
// data-testid: bug-replay-marker (on both inline and lightbox markers)
// ---------------------------------------------------------------------------

type Props = {
  screenshotUrl: string | null;
  clickXPct: number;
  clickYPct: number;
  cssSelector: string;
  elementLabel: string | null;
};

function Marker({ clickXPct, clickYPct }: { clickXPct: number; clickYPct: number }) {
  return (
    <div
      data-testid="bug-replay-marker"
      className="pointer-events-none absolute"
      style={{
        left: `${clickXPct}%`,
        top: `${clickYPct}%`,
        transform: "translate(-50%, -50%)",
      }}
    >
      <div className="relative flex h-6 w-6 items-center justify-center">
        <div className="absolute h-6 w-6 animate-ping rounded-full bg-emerald-500 opacity-75" />
        <div className="relative h-4 w-4 rounded-full border-2 border-white bg-emerald-500 shadow-lg" />
      </div>
    </div>
  );
}

export function BugReplayOverlay({
  screenshotUrl,
  clickXPct,
  clickYPct,
  cssSelector,
  elementLabel,
}: Props) {
  const [lightboxOpen, setLightboxOpen] = useState(false);

  if (!screenshotUrl) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-400">
        No screenshot available
      </div>
    );
  }

  return (
    <>
      {/* Inline thumbnail — clicking opens lightbox */}
      <button
        type="button"
        onClick={() => setLightboxOpen(true)}
        className="relative block w-full cursor-zoom-in overflow-hidden rounded-lg border border-gray-200 bg-gray-900 text-left"
        title="Click to view full size"
      >
        {/* §1 render fix: w-full with no height constraint — natural aspect
            ratio, no letterboxing. Marker percentages map directly to image. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={screenshotUrl}
          alt="Screenshot replay"
          className="w-full"
          draggable={false}
        />
        <Marker clickXPct={clickXPct} clickYPct={clickYPct} />

        {/* Element label badge */}
        {(elementLabel ?? cssSelector) && (
          <div className="absolute left-2 right-2 bottom-2 rounded bg-black/70 px-2 py-1 text-xs text-white">
            <span className="font-mono">{cssSelector}</span>
            {elementLabel && <span className="ml-2 text-gray-300">({elementLabel})</span>}
          </div>
        )}
      </button>

      {/* §3 — Full-size lightbox */}
      {lightboxOpen && (
        <div
          className="fixed inset-0 z-[10100] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Screenshot full size"
          onKeyDown={(e) => e.key === "Escape" && setLightboxOpen(false)}
          tabIndex={0}
        >
          <div
            className="relative max-h-full max-w-full overflow-auto rounded-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={screenshotUrl}
              alt="Screenshot replay — full size"
              className="max-h-[90vh] w-auto rounded-lg"
              draggable={false}
            />
            <Marker clickXPct={clickXPct} clickYPct={clickYPct} />
          </div>
          <button
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            onClick={() => setLightboxOpen(false)}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
