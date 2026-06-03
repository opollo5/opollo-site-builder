"use client";

// ---------------------------------------------------------------------------
// BugReplayOverlay — renders a screenshot with the click marker at the
// stored percentage coordinates (click_x_pct / click_y_pct).
//
// The percentage offset is the forensic anchor: it survives viewport
// resize and renders correctly on any screen size.
//
// data-testid: bug-replay-marker
// ---------------------------------------------------------------------------

type Props = {
  screenshotUrl: string | null;
  clickXPct: number;
  clickYPct: number;
  cssSelector: string;
  elementLabel: string | null;
};

export function BugReplayOverlay({
  screenshotUrl,
  clickXPct,
  clickYPct,
  cssSelector,
  elementLabel,
}: Props) {
  if (!screenshotUrl) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-400">
        No screenshot available
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-gray-900">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={screenshotUrl}
        alt="Bug replay screenshot"
        className="w-full object-contain"
      />

      {/* Click marker positioned at the stored percentage coordinates */}
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

      {/* Element label badge */}
      {(elementLabel ?? cssSelector) && (
        <div
          className="absolute left-2 right-2 bottom-2 rounded bg-black/70 px-2 py-1 text-xs text-white"
          style={{ top: undefined }}
        >
          <span className="font-mono">{cssSelector}</span>
          {elementLabel && <span className="ml-2 text-gray-300">({elementLabel})</span>}
        </div>
      )}
    </div>
  );
}
