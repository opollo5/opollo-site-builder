"use client";

import { useState } from "react";

// Phase 1.5 follow-up — side-by-side import review (§7.5.2 step 5).
//
// LEFT: cached snapshot — the HTML we captured at import time, rendered
//       via iframe srcDoc. This is what the runner will see.
// RIGHT: live URL — what's currently at the source URL. Lets the
//        operator detect drift between capture time and now.
//
// Iframe sandboxing: srcDoc rendering is sandboxed (allow-same-origin
// off, no scripts) so the cached HTML can't reach back into our app.
// The live URL uses a regular src; many sites set X-Frame-Options to
// DENY/SAMEORIGIN, so a fallback link is always shown beneath.
//
// Rendered-import preview is a placeholder until the brief-runner
// consumer of mode='import' lands; the brief-run status + link gets
// the operator to the existing run progress page.

export function ImportSideBySide({
  cachedHtml,
  liveUrl,
  briefRunStatus,
  briefRunHref,
  briefRunCreatedAt,
}: {
  cachedHtml: string;
  liveUrl: string | null;
  briefRunStatus: string | null;
  briefRunHref: string | null;
  briefRunCreatedAt: string | null;
}) {
  const [showLive, setShowLive] = useState(true);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Cached snapshot (left) is what the runner will reproduce. Live
          URL (right) is the current state of the source — drift between
          the two is operator-visible signal that the page has changed
          since capture.
        </p>
        <button
          type="button"
          onClick={() => setShowLive((v) => !v)}
          className="rounded-md border border-border px-3 py-1 text-xs hover:bg-muted"
        >
          {showLive ? "Hide live preview" : "Show live preview"}
        </button>
      </div>

      <div className={`grid gap-4 ${showLive ? "lg:grid-cols-2" : "lg:grid-cols-1"}`}>
        <section className="space-y-2 rounded-lg border border-border bg-card p-3">
          <header className="flex items-center justify-between text-sm">
            <span className="font-medium">Cached snapshot</span>
            <span className="text-xs text-muted-foreground">
              capture-time HTML, sandboxed
            </span>
          </header>
          <iframe
            title="Cached snapshot"
            srcDoc={cachedHtml}
            sandbox=""
            className="h-[640px] w-full rounded-md border border-border bg-white"
          />
        </section>

        {showLive && (
          <section className="space-y-2 rounded-lg border border-border bg-card p-3">
            <header className="flex items-center justify-between text-sm">
              <span className="font-medium">Live URL</span>
              {liveUrl && (
                <a
                  href={liveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs underline-offset-4 hover:underline"
                >
                  open ↗
                </a>
              )}
            </header>
            {liveUrl ? (
              <>
                <iframe
                  title="Live source URL"
                  src={liveUrl}
                  sandbox="allow-same-origin"
                  className="h-[640px] w-full rounded-md border border-border bg-white"
                />
                <p className="text-xs text-muted-foreground">
                  Many sites set X-Frame-Options to DENY/SAMEORIGIN — if
                  the iframe is blank, open the URL in a new tab using
                  the link above.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No source URL recorded for this import.
              </p>
            )}
          </section>
        )}
      </div>

      <section className="rounded-lg border border-dashed border-border bg-muted/40 p-4 text-sm">
        <p className="font-medium">Rendered import</p>
        {briefRunStatus ? (
          <p className="mt-1 text-muted-foreground">
            Brief run is{" "}
            <code className="font-mono text-xs">{briefRunStatus}</code>
            {briefRunCreatedAt && (
              <>
                {" "}· created {new Date(briefRunCreatedAt).toLocaleString()}
              </>
            )}
            .{" "}
            {briefRunHref && (
              <a
                href={briefRunHref}
                className="underline-offset-4 hover:underline"
              >
                Watch run →
              </a>
            )}
          </p>
        ) : (
          <p className="mt-1 text-muted-foreground">No brief run yet.</p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          The brief-runner consumer of mode=&apos;import&apos; lands in a
          follow-up sub-slice. Once shipped, this panel will render the
          Site-Builder-native output alongside the source.
        </p>
      </section>
    </div>
  );
}
