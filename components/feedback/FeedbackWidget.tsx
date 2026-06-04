"use client";

import html2canvas from "html2canvas";
import { useCallback, useEffect, useRef, useState } from "react";

import { CreateTaskPopup } from "./CreateTaskPopup";
import { ElementPicker, type PickResult } from "./ElementPicker";

// §2: rail/tray mode removed — single click goes straight to picker.
type Mode = "collapsed" | "picking" | "creating" | "submitted";

type Props = {
  companyId: string;
};

// ---------------------------------------------------------------------------
// FeedbackWidget — pill → picker → create popup flow.
//
// §1 Position: bottom-LEFT at left-20 bottom-4 (80px from left edge clears
//    the 64px collapsed primary nav rail + 16px buffer). Eliminates the
//    bottom-right collision with DebugFooter (fixed bottom-2 right-2).
// §2 No intermediate tray: pill click → picker immediately (one action).
// §3 No count badge.
// §4 Naming: "Report an issue" / "Send report".
//
// data-testid: feedback-tab, feedback-picker, feedback-create-popup,
//              feedback-submit
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

  // §2: clicking the pill goes straight to picking — no intermediate tray.
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
        // §2: cancel returns to collapsed, not a now-deleted rail
        onCancel={() => setMode("collapsed")}
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
        onClose={() => setMode("collapsed")}
        onSubmitted={onSubmitted}
      />
    );
  }

  if (mode === "submitted") {
    return (
      // §1: submitted toast also moves to bottom-left
      <div className="fixed left-20 bottom-4 z-[10001] rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg">
        ✓ Report submitted
      </div>
    );
  }

  // §1 — Collapsed pill: bottom-LEFT (left-20 = 80px, clears nav rail).
  // §2 — Single click → picker immediately (no intermediate tray).
  return (
    <button
      data-testid="feedback-tab"
      onClick={startPicking}
      className="fixed left-20 bottom-4 z-[9997] flex min-h-[44px] items-center gap-2 rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-lg transition-all hover:bg-emerald-700 hover:shadow-xl active:scale-[0.98]"
      title="Report an issue"
      aria-label="Open issue reporter"
    >
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
