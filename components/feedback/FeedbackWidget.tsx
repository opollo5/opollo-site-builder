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
// FeedbackWidget — pill → rail → picker → create popup flow.
//
// §1 Collapsed tab: horizontal pill (emerald filled, floating bottom-right,
//    "Report an issue" label + icon, depth shadow, ≥44px touch target).
// §2 Rail: real Button primitive, "Report an issue" label, ≥44px.
// §3 No count badge (removed entirely — admin info only).
// §5 Naming: "Report an issue" everywhere customer-facing.
//
// data-testid: feedback-tab, feedback-rail, feedback-picker,
//              feedback-create-popup, feedback-submit
// ---------------------------------------------------------------------------

const MAX_CONSOLE_ERRORS = 50;

type ConsoleLine = { level: "error" | "warn"; msg: string; at: string };

export function FeedbackWidget({ companyId }: Props) {
  const [mode, setMode] = useState<Mode>("collapsed");
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

  const startPicking = useCallback(() => {
    setPageUrl(window.location.href);
    setMode("picking");
  }, []);

  const onPick = useCallback(async (result: PickResult) => {
    setMode("creating");
    setPick(result);

    try {
      const canvas = await html2canvas(document.body, {
        useCORS: true,
        allowTaint: true,
        scale: 1,
        logging: false,
      });
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

  const onSubmitted = useCallback((_ticketId: string) => {
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
      <div className="fixed right-6 bottom-6 z-[10001] rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg">
        ✓ Report submitted
      </div>
    );
  }

  if (mode === "rail") {
    return (
      <div
        data-testid="feedback-rail"
        className="fixed right-4 bottom-4 z-[9997] flex flex-col items-stretch gap-2 rounded-2xl border border-gray-200 bg-white p-3 shadow-xl"
        style={{ minWidth: 180 }}
      >
        {/* §2 — Primary action: real filled button, ≥44px, labeled */}
        <button
          onClick={startPicking}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-emerald-700 hover:shadow-md active:scale-[0.98]"
          title="Pick an element to report an issue"
        >
          {/* Bug/flag icon */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
            <line x1="4" y1="22" x2="4" y2="15" />
          </svg>
          Report an issue
        </button>

        {/* Collapse control — ≥44px hit area */}
        <button
          onClick={() => setMode("collapsed")}
          className="flex min-h-[44px] items-center justify-center rounded-xl text-xs text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600"
          title="Collapse"
          aria-label="Collapse issue reporter"
        >
          Close ×
        </button>
      </div>
    );
  }

  // §1 — Collapsed: horizontal pill, floating, emerald filled, depth shadow.
  return (
    <button
      data-testid="feedback-tab"
      onClick={() => setMode("rail")}
      className="fixed right-4 bottom-4 z-[9997] flex min-h-[44px] items-center gap-2 rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-lg transition-all hover:bg-emerald-700 hover:shadow-xl active:scale-[0.98]"
      title="Report an issue"
      aria-label="Open issue reporter"
    >
      {/* Bug/flag icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
        <line x1="4" y1="22" x2="4" y2="15" />
      </svg>
      Report an issue
    </button>
  );
}
