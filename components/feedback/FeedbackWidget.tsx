"use client";

import html2canvas from "html2canvas";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

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
import type { DebugApiEvent, DebugSnapshot } from "@/lib/feedback/types";

// ---------------------------------------------------------------------------
// FeedbackWidget — combined report + debug widget, middle-right vertical tab.
//
// Position: right-edge, vertically centered (Crisp/Zonka style).
//   §2 Not bottom-right — reserved for future chatbot.
//   §3 Tab click → intro modal → element picker → report form.
//
// Debug panel: consolidated from the former standalone DebugFooter.
//   Accessible via the "Debug" tab inside this widget.
//   Auto-attaches a debug snapshot to every submitted ticket.
//
// API event capture: fetch interceptor installed on mount, window-scoped
//   singleton so it survives soft-nav. Tracks last 20 /api/* calls.
//
// data-testid: feedback-tab, feedback-intro-modal, feedback-picker,
//              feedback-picker-hint, feedback-create-popup, feedback-submit,
//              feedback-debug-panel
// ---------------------------------------------------------------------------

type Mode = "collapsed" | "intro" | "picking" | "creating" | "submitted";
type PanelTab = "report" | "debug";

// Extend Window to hold the singleton capture store.
interface OpolloDebugWindow extends Window {
  __opolloDebug?: {
    events: DebugApiEvent[];
    push: (e: DebugApiEvent) => void;
  };
}
declare const window: OpolloDebugWindow;

function ensureApiCapture() {
  if (typeof window === "undefined" || window.__opolloDebug) return;
  const events: DebugApiEvent[] = [];
  window.__opolloDebug = {
    events,
    push(e) {
      events.push(e);
      if (events.length > 20) events.shift();
    },
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const t0 = performance.now();
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : (input as Request).url;
    const method = ((init?.method ?? (input instanceof Request ? input.method : "GET")) || "GET").toUpperCase();
    try {
      const res = await originalFetch(input, init);
      if (url.includes("/api/")) {
        try {
          const u = new URL(url, window.location.origin);
          window.__opolloDebug!.push({
            ts: Date.now(),
            method,
            path: u.pathname + u.search,
            status: res.status,
            requestId: res.headers.get("x-request-id"),
            durationMs: Math.round(performance.now() - t0),
          });
        } catch { /* best-effort */ }
      }
      return res;
    } catch (err) {
      if (url.includes("/api/")) {
        try {
          const u = new URL(url, window.location.origin);
          window.__opolloDebug!.push({
            ts: Date.now(),
            method,
            path: u.pathname + u.search,
            status: 0,
            requestId: null,
            durationMs: Math.round(performance.now() - t0),
          });
        } catch { /* best-effort */ }
      }
      throw err;
    }
  };
}

const MAX_CONSOLE_ERRORS = 50;
type ConsoleLine = { level: "error" | "warn"; msg: string; at: string };

type Props = {
  companyId: string;
  skipIntro?: boolean;
  /** Passed from the server layout — baked into debug snapshot. */
  buildSha?: string | null;
  vercelEnv?: string | null;
  userEmail?: string | null;
};

export function FeedbackWidget({
  companyId,
  skipIntro = false,
  buildSha = null,
  vercelEnv = null,
  userEmail = null,
}: Props) {
  const pathname = usePathname();
  const [mode, setMode] = useState<Mode>("collapsed");
  const [panelTab, setPanelTab] = useState<PanelTab>("report");
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [pick, setPick] = useState<PickResult | null>(null);
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(null);
  const [pageUrl, setPageUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [eventsTick, setEventsTick] = useState(0);
  const consoleRef = useRef<ConsoleLine[]>([]);

  // Install console ring buffer + API event capture on mount.
  useEffect(() => {
    ensureApiCapture();
    const tick = setInterval(() => setEventsTick((n) => n + 1), 2000);

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
      clearInterval(tick);
      console.error = origError;
      console.warn = origWarn;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandled);
    };
  }, []);

  // Keep eventsTick in deps so eslint doesn't warn — it drives debug re-render.
  const apiEvents: DebugApiEvent[] =
    typeof window !== "undefined" ? (window.__opolloDebug?.events ?? []) : [];
  void eventsTick; // consumed by the interval above

  function buildDebugSnapshot(): DebugSnapshot {
    return {
      buildSha,
      route: typeof window !== "undefined" ? window.location.pathname : pathname,
      vercelEnv,
      userEmail,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      viewport:
        typeof window !== "undefined"
          ? { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }
          : { w: 0, h: 0, dpr: 1 },
      apiEvents: apiEvents.slice(-20),
    };
  }

  function buildDebugText(): string {
    const lines: string[] = [];
    lines.push("opollo debug snapshot");
    lines.push(`captured-at: ${new Date().toISOString()}`);
    lines.push(`route: ${pathname ?? "(unknown)"}`);
    lines.push(`build-sha: ${buildSha ?? "(unset)"}`);
    lines.push(`vercel-env: ${vercelEnv ?? "(unset)"}`);
    lines.push(`user: ${userEmail ?? "(none)"}`);
    if (typeof navigator !== "undefined") {
      lines.push(`ua: ${navigator.userAgent}`);
      lines.push(
        `viewport: ${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio}`,
      );
    }
    lines.push("");
    lines.push(`recent api events (${apiEvents.length}):`);
    for (const e of apiEvents.slice(-20)) {
      const age = Math.round((Date.now() - e.ts) / 1000);
      lines.push(
        `  ${e.method.padEnd(6)} ${String(e.status).padStart(3)} ${e.durationMs}ms` +
        ` x-request-id=${e.requestId ?? "-"} ${e.path} (${age}s ago)`,
      );
    }
    return lines.join("\n");
  }

  async function handleCopyDebug() {
    try {
      await navigator.clipboard.writeText(buildDebugText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }

  const errorCount = apiEvents.filter((e) => e.status === 0 || e.status >= 400).length;

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
    setTimeout(() => setMode("collapsed"), 2500);
  }, []);

  const handleStartPicking = useCallback(async () => {
    if (dontShowAgain) {
      void fetch("/api/feedback/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skip_intro: true }),
      }).catch(() => {});
    }
    startPicking();
  }, [dontShowAgain, startPicking]);

  // Element picker takes over the full viewport — render it standalone.
  if (mode === "picking") {
    return <ElementPicker onPick={onPick} onCancel={() => setMode("collapsed")} />;
  }

  // Report form — repositioned to right side.
  if (mode === "creating" && pick) {
    return (
      <CreateTaskPopup
        companyId={companyId}
        pick={pick}
        screenshotDataUrl={screenshotDataUrl}
        consoleErrors={consoleRef.current}
        pageUrl={pageUrl}
        debugSnapshot={buildDebugSnapshot()}
        onClose={() => setMode("collapsed")}
        onSubmitted={onSubmitted}
      />
    );
  }

  // Submitted confirmation.
  if (mode === "submitted") {
    return (
      <div
        className="fixed right-12 bottom-6 z-[10001] rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg"
        suppressHydrationWarning
      >
        ✓ Report submitted
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Intro modal shown as Dialog (centered) — existing flow, same UX.
  // ---------------------------------------------------------------------------
  if (mode === "intro" && panelTab === "report") {
    return (
      <>
        {/* Keep the launcher tab visible so the user can see context */}
        <LauncherTab
          errorCount={errorCount}
          onClick={() => setMode("collapsed")}
          active
        />
        <Dialog
          open
          onOpenChange={(open) => { if (!open) setMode("collapsed"); }}
        >
          <DialogContent data-testid="feedback-intro-modal" className="z-[10200] max-w-md">
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold">
                Show us where it&apos;s not working
              </DialogTitle>
              <DialogDescription className="text-sm text-gray-600 leading-relaxed">
                Click anywhere on the page that&apos;s broken or wrong. We&apos;ll capture a
                screenshot and pin the exact spot for our team.
              </DialogDescription>
            </DialogHeader>
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
              <Button variant="ghost" onClick={() => setMode("collapsed")} className="min-h-[44px]">
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Debug panel — shown as floating panel to left of launcher tab.
  // ---------------------------------------------------------------------------
  if (mode === "intro" && panelTab === "debug") {
    return (
      <>
        <LauncherTab errorCount={errorCount} onClick={() => setMode("collapsed")} active />
        <div
          data-testid="feedback-debug-panel"
          className="fixed right-10 z-[10001] flex w-[480px] flex-col rounded-xl border border-gray-200 bg-white shadow-2xl"
          style={{ top: "50%", transform: "translateY(-50%)" }}
          suppressHydrationWarning
        >
          {/* Panel header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <div className="flex gap-1">
              <PanelTabBtn active={false} onClick={() => setPanelTab("report")}>
                Report
              </PanelTabBtn>
              <PanelTabBtn active>Debug</PanelTabBtn>
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={handleCopyDebug}
                className="rounded border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
              <button
                type="button"
                onClick={() => setMode("collapsed")}
                className="flex h-7 w-7 items-center justify-center rounded text-gray-400 hover:bg-gray-100"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Debug content */}
          <div className="max-h-[70vh] overflow-auto p-4">
            <pre className="whitespace-pre-wrap break-all rounded border border-gray-100 bg-gray-50 p-3 font-mono text-xs text-gray-700">
              {buildDebugText()}
            </pre>
            <p className="mt-3 text-xs text-gray-400">
              Copy and paste this into a chat with engineering along with what you were doing.
            </p>
          </div>
        </div>
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Collapsed — just the vertical launcher tab.
  // ---------------------------------------------------------------------------
  return (
    <div
      className="fixed right-0 z-[9997] flex flex-col"
      style={{ top: "50%", transform: "translateY(-50%)" }}
      suppressHydrationWarning
    >
      {/* Primary report tab */}
      <button
        data-testid="feedback-tab"
        onClick={() => {
          setPanelTab("report");
          if (skipIntro) {
            startPicking();
          } else {
            setMode("intro");
          }
        }}
        className="flex items-center gap-1.5 rounded-l-lg bg-emerald-600 px-2.5 py-4 text-white shadow-md transition-colors hover:bg-emerald-700 active:scale-[0.98]"
        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        title="Report an issue"
        aria-label="Open issue reporter"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ transform: "rotate(180deg)" }}
        >
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <line x1="4" y1="22" x2="4" y2="15" />
        </svg>
        <span className="text-xs font-semibold tracking-wide">Feedback</span>
      </button>

      {/* Debug sub-tab */}
      <button
        onClick={() => {
          setPanelTab("debug");
          setMode("intro");
        }}
        className="mt-px flex items-center justify-center gap-1 rounded-bl-lg border-t border-emerald-700 bg-emerald-600 px-2.5 py-2 text-emerald-100 transition-colors hover:bg-emerald-700"
        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        title="Debug panel"
        aria-label="Open debug panel"
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${errorCount > 0 ? "bg-red-300" : "bg-emerald-300"}`}
          style={{ transform: "rotate(180deg)" }}
          aria-hidden
        />
        <span className="text-xs">Debug</span>
        {errorCount > 0 && (
          <span className="text-xs font-bold" style={{ transform: "rotate(180deg)" }}>
            {errorCount}
          </span>
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function LauncherTab({
  errorCount,
  onClick,
  active = false,
}: {
  errorCount: number;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`fixed right-0 z-[9997] flex flex-col items-center gap-1.5 rounded-l-lg px-2.5 py-4 shadow-md transition-colors ${
        active
          ? "bg-emerald-700 text-white"
          : "bg-emerald-600 text-white hover:bg-emerald-700"
      }`}
      style={{ top: "50%", transform: "translateY(-50%) rotate(180deg)", writingMode: "vertical-rl" }}
      aria-label="Close"
    >
      {errorCount > 0 && (
        <span className="h-1.5 w-1.5 rounded-full bg-red-300" aria-hidden />
      )}
      <span className="text-xs font-semibold tracking-wide">Feedback</span>
    </button>
  );
}

function PanelTabBtn({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-gray-100 text-gray-900"
          : "text-gray-500 hover:text-gray-700"
      }`}
    >
      {children}
    </button>
  );
}
