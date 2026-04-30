"use client";

interface View {
  swatches: string[];
  fonts: string[];
  layout_tags: string[];
  visual_tone_tags: string[];
  visual_tone: string;
  screenshot_url: string | null;
}

const SWATCH_LABELS = ["Primary", "Secondary", "Accent", "Background", "Text"];

export function MoodBoardStrip({ view }: { view: View }) {
  return (
    <div
      className="rounded-lg border bg-muted/20 p-4"
      data-testid="mood-board-strip"
    >
      <h3 className="text-sm font-semibold">Mood board</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        What we&apos;re hearing so far. Updates as you add inputs.
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto]">
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Colour swatches
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {view.swatches.length > 0 ? (
                view.swatches.slice(0, 8).map((c, i) => (
                  <span
                    key={`${c}-${i}`}
                    className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[10px]"
                    title={c}
                  >
                    <span
                      className="inline-block h-4 w-4 rounded-sm border"
                      style={{ background: c }}
                      aria-hidden
                    />
                    <span className="font-mono uppercase">
                      {SWATCH_LABELS[i] ?? `c${i + 1}`}
                    </span>
                  </span>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Typography
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              {view.fonts.length > 0 ? (
                view.fonts.slice(0, 3).map((f) => (
                  <span
                    key={f}
                    className="inline-flex items-baseline gap-2 rounded-md border bg-background px-2 py-1"
                    style={{ fontFamily: `${f}, system-ui, sans-serif` }}
                  >
                    <span className="text-base">Aa Bb Cc 123</span>
                    <span className="text-xs text-muted-foreground">{f}</span>
                  </span>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Layout
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {view.layout_tags.length > 0 ? (
                  view.layout_tags.slice(0, 5).map((t) => (
                    <span
                      key={t}
                      className="rounded-full border bg-background px-2 py-0.5 text-[10px]"
                    >
                      {t}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Visual tone
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {view.visual_tone_tags.length > 0 ? (
                  view.visual_tone_tags.slice(0, 5).map((t) => (
                    <span
                      key={t}
                      className="rounded-full border bg-foreground/10 px-2 py-0.5 text-[10px]"
                    >
                      {t}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {view.screenshot_url && (
          <div className="hidden md:block">
            <p className="text-xs font-medium text-muted-foreground">
              Reference
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={view.screenshot_url}
              alt="Reference site screenshot"
              className="mt-1.5 h-32 w-48 rounded-md border object-cover"
              data-testid="mood-board-screenshot"
              loading="lazy"
            />
          </div>
        )}
      </div>
    </div>
  );
}
