"use client";

import html2canvas from "html2canvas";
import { useCallback, useEffect, useRef, useState } from "react";

import { CreateTaskPopup } from "./CreateTaskPopup";
import { ElementPicker, type PickResult } from "./ElementPicker";

type Mode = "collapsed" | "rail" | "picking" | "creating" | "submitted";

type Props = {
  companyId: string;
};

// ---------------------------------------------------------------------------
// FeedbackWidget — tab → rail → picker → create popup flow.
//
// Mounted ONCE in the authenticated app shell. Not rendered:
//   - before auth resolves
//   - for logged-out users
//   - on public/magic-link routes
//
// The component installs a console ring buffer at mount time to capture
// the last N console.error / console.warn / window.onerror events.
//
// data-testid surface:
//   feedback-tab, feedback-rail, feedback-picker (on ElementPicker),
//   feedback-create-popup, feedback-submit (on CreateTaskPopup)
// ---------------------------------------------------------------------------

const MAX_CONSOLE_ERRORS = 50;

type ConsoleLine = { level: "error" | "warn"; msg: string; at: string };

export function FeedbackWidget({ companyId }: Props) {
  const [mode, setMode] = useState<Mode>("collapsed");
  const [openCount, setOpenCount] = useState<number | null>(null);
  const [pick, setPick] = useState<PickResult | null>(null);
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(null);
  const [pageUrl, setPageUrl] = useState("");
  const consoleRef = useRef<ConsoleLine[]>([]);

  // Install console ring buffer on mount.
  useEffect(() => {
    const origError = console.error.bind(console);
    const origWarn = console.warn.bind(console);

    function push(level: "error" | "warn", ...args: unknown[]) {
      const line: ConsoleLine = {
        level,
        msg: args.map(String).join(" ").slice(0, 500),
        at: new Date().toISOString(),
      };
      consoleRef.current = [...consoleRef.current.slice(-(MAX_CONSOLE_ERRORS - 1)), line];
    }

    console.error = (...args: unknown[]) => { push("error", ...args); origError(...args); };
    console.warn = (...args: unknown[]) => { push("warn", ...args); origWarn(...args); };

    const onError = (e: ErrorEvent) => push("error", e.message, e.filename, e.lineno);
    const onUnhandled = (e: PromiseRejectionEvent) => push("error", String(e.reason));

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandled);

    return () => {
      console.error = origError;
      console.warn = origWarn;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandled);
    };
  }, []);

  // Fetch open ticket count for this company when rail opens.
  useEffect(() => {
    if (mode !== "rail") return;
    fetch(`/api/feedback/tickets?companyId=${companyId}&status=backlog`)
      .then((r) => r.json())
      .then((body) => {
        if (body.ok) setOpenCount(body.data.tickets.length);
      })
      .catch(() => {});
  }, [mode, companyId]);

  const startPicking = useCallback(() => {
    setPageUrl(window.location.href);
    setMode("picking");
  }, []);

  const onPick = useCallback(async (result: PickResult) => {
    setMode("creating");
    setPick(result);

    // Capture screenshot with html2canvas (best-effort; cross-origin iframes may fail).
    try {
      const canvas = await html2canvas(document.body, {
        useCORS: true,
        allowTaint: true,
        scale: 1,
        logging: false,
      });
      // Draw the click pin.
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const pinX = (result.clickXPct / 100) * canvas.width;
        const pinY = (result.clickYPct / 100) * canvas.height;
        ctx.beginPath();
        ctx.arc(pinX, pinY, 12, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,191,102,0.9)";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      setScreenshotDataUrl(canvas.toDataURL("image/png"));
    } catch {
      setScreenshotDataUrl(null);
    }
  }, []);

  const onSubmitted = useCallback((ticketId: string) => {
    setMode("submitted");
    setTimeout(() => setMode("collapsed"), 2000);
  }, []);

  if (mode === "picking") {
    return (
      <ElementPicker
        onPick={onPick}
        onCancel={() => setMode("rail")}
      />
    );
  }

  if (mode === "creating" && pick) {
    return (
      <CreateTaskPopup
        companyId={companyId}
        pick={pick}
        screenshotDataUrl={screenshotDataUrl}
        consoleErrors={consoleRef.current}
        pageUrl={pageUrl}
        onClose={() => setMode("rail")}
        onSubmitted={onSubmitted}
      />
    );
  }

  if (mode === "submitted") {
    return (
      <div className="fixed right-4 bottom-4 z-[10001] rounded-md bg-emerald-600 px-4 py-2 text-sm text-white shadow-lg">
        ✓ Bug report submitted
      </div>
    );
  }

  if (mode === "rail") {
    return (
      <div
        data-testid="feedback-rail"
        className="fixed right-0 bottom-12 z-[9997] flex flex-col items-center rounded-l-xl border border-r-0 border-gray-200 bg-white shadow-xl"
      >
        {/* Brand mark */}
        <div className="px-3 py-2 text-[10px] font-semibold tracking-widest text-gray-400">
          BUGS
        </div>

        {/* + button */}
        <button
          onClick={startPicking}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-lg text-gray-600 hover:bg-emerald-50 hover:text-emerald-700"
          title="Pick an element to report a bug"
        >
          +
        </button>

        {/* Open count badge */}
        {openCount !== null && openCount > 0 && (
          <div className="mb-1 h-5 w-5 rounded-full bg-emerald-600 text-center text-[10px] leading-5 text-white">
            {openCount > 99 ? "99+" : openCount}
          </div>
        )}

        {/* Collapse chevron */}
        <button
          onClick={() => setMode("collapsed")}
          className="px-3 py-2 text-xs text-gray-400 hover:text-gray-600"
          title="Collapse"
          aria-label="Collapse feedback rail"
        >
          ›
        </button>
      </div>
    );
  }

  // Collapsed: small tab.
  return (
    <button
      data-testid="feedback-tab"
      onClick={() => setMode("rail")}
      className="fixed right-0 bottom-12 z-[9997] flex h-10 w-8 items-center justify-center rounded-l-md border border-r-0 border-gray-200 bg-white shadow-md hover:bg-emerald-50"
      title="Report a bug"
      aria-label="Open bug reporter"
    >
      <span className="rotate-90 text-xs font-semibold text-gray-500">BUG</span>
    </button>
  );
}
