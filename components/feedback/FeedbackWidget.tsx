"use client";

import html2canvas from "html2canvas";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CreateTaskPopup } from "./CreateTaskPopup";
import { ElementPicker, type PickResult } from "./ElementPicker";

// ---------------------------------------------------------------------------
// FeedbackWidget — intro modal → picker → report popup flow.
//
// §1 Position: bottom-LEFT at left-20 bottom-4 (clears 64px nav rail).
// §2 No intermediate tray: tab click → intro modal → picker → popup.
// §4 Naming: "Report an issue" / "Send report".
//
// Flow:
//   collapsed → [tab click] → intro → [Start picking] → picking →
//   [element click] → creating → [submit] → submitted → collapsed
//   Esc at intro or picking → collapsed
//
// Backlog: "don't show again" preference for the intro modal.
//
// data-testid: feedback-tab, feedback-intro-modal, feedback-picker,
//              feedback-picker-hint, feedback-create-popup, feedback-submit
// ---------------------------------------------------------------------------

type Mode = "collapsed" | "intro" | "picking" | "creating" | "submitted";

type Props = {
  companyId: string;
  /** Server-resolved from platform_users.preferences.feedback_skip_intro.
   *  When true, tab click bypasses the intro modal and goes straight to picker. */
  skipIntro?: boolean;
};

const MAX_CONSOLE_ERRORS = 50;

type ConsoleLine = { level: "error" | "warn"; msg: string; at: string };

export function FeedbackWidget({ companyId, skipIntro = false }: Props) {
  const [mode, setMode] = useState<Mode>("collapsed");
  const [dontShowAgain, setDontShowAgain] = useState(false);
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

  // Save the "don't show again" preference then start picking.
  const handleStartPicking = useCallback(async () => {
    if (dontShowAgain) {
      // Fire-and-forget — don't block the user interaction.
      void fetch("/api/feedback/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skip_intro: true }),
      }).catch(() => {});
    }
    startPicking();
  }, [dontShowAgain, startPicking]);

  if (mode === "intro") {
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) setMode("collapsed");
        }}
      >
        <DialogContent
          data-testid="feedback-intro-modal"
          className="z-[10200] max-w-md"
        >
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              Show us where it&apos;s not working
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-600 leading-relaxed">
              Click anywhere on the page that&apos;s broken or wrong. We&apos;ll capture a
              screenshot and pin the exact spot for our team.
            </DialogDescription>
          </DialogHeader>

          {/* "Don't show again" checkbox */}
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-500">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 accent-emerald-600"
              data-testid="feedback-intro-skip-checkbox"
            />
            Don&apos;t show this again
          </label>

          <DialogFooter className="mt-2 flex gap-2 sm:flex-row-reverse">
            <Button
              onClick={handleStartPicking}
              className="min-h-[44px] bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Start picking
            </Button>
            <Button
              variant="ghost"
              onClick={() => setMode("collapsed")}
              className="min-h-[44px]"
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (mode === "picking") {
    return (
      <ElementPicker
        onPick={onPick}
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
      <div className="fixed left-20 bottom-4 z-[10001] rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg">
        ✓ Report submitted
      </div>
    );
  }

  // Collapsed pill — tab click opens intro modal UNLESS the user has set
  // "don't show again", in which case we go straight to picker.
  return (
    <button
      data-testid="feedback-tab"
      onClick={() => skipIntro ? startPicking() : setMode("intro")}
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
