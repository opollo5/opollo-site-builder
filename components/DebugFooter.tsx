"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// ---------------------------------------------------------------------------
// DebugFooter — super_admin-only ops widget.
//
// Fixed bottom-right pill that expands to a copy-pasteable diagnostic
// blob covering: route, build SHA, deploy env, recent x-request-ids
// observed on this tab, recent 4xx/5xx responses, browser/UA. Copying
// it into an issue or chat dramatically shortens the round-trip when
// debugging UI bugs.
//
// Wired into the shared admin layout below the Toaster. Gated on
// `isSuperAdmin` so operators don't see it.
//
// Capture mechanism: a tiny fetch interceptor records the last 20
// requests to /api/* (request-id from `x-request-id` header, status,
// path, ts). Window-scoped so it survives soft-nav. Cleared on full
// page reload.
// ---------------------------------------------------------------------------

interface ApiEvent {
  ts: number;
  method: string;
  path: string;
  status: number;
  request_id: string | null;
  duration_ms: number;
}

interface DebugWindow extends Window {
  __opolloDebug?: {
    events: ApiEvent[];
    push: (e: ApiEvent) => void;
  };
}

declare const window: DebugWindow;

function ensureCapture() {
  if (typeof window === "undefined") return;
  if (window.__opolloDebug) return;
  const events: ApiEvent[] = [];
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
        : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
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
            request_id: res.headers.get("x-request-id"),
            duration_ms: Math.round(performance.now() - t0),
          });
        } catch {
          // best-effort logging — never break a real request
        }
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
            request_id: null,
            duration_ms: Math.round(performance.now() - t0),
          });
        } catch {
          // ignore
        }
      }
      throw err;
    }
  };
}

interface DebugFooterProps {
  buildSha: string | null;
  vercelEnv: string | null;
  userEmail: string | null;
  userRole: string | null;
}

export function DebugFooter({
  buildSha,
  vercelEnv,
  userEmail,
  userRole,
}: DebugFooterProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [eventsTick, setEventsTick] = useState(0);

  useEffect(() => {
    ensureCapture();
    const id = setInterval(() => setEventsTick((n) => n + 1), 2000);
    return () => clearInterval(id);
  }, []);

  const events =
    typeof window !== "undefined" ? window.__opolloDebug?.events ?? [] : [];

  function buildBlob(): string {
    const lines: string[] = [];
    lines.push("opollo debug snapshot");
    lines.push(`captured-at: ${new Date().toISOString()}`);
    lines.push(`route: ${pathname ?? "(unknown)"}`);
    lines.push(`build-sha: ${buildSha ?? "(unset)"}`);
    lines.push(`vercel-env: ${vercelEnv ?? "(unset)"}`);
    lines.push(`user: ${userEmail ?? "(none)"} (${userRole ?? "no role"})`);
    if (typeof navigator !== "undefined") {
      lines.push(`ua: ${navigator.userAgent}`);
      lines.push(
        `viewport: ${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio}`,
      );
    }
    lines.push("");
    lines.push(`recent api events (${events.length}):`);
    for (const e of events.slice(-20)) {
      const age = Math.round((Date.now() - e.ts) / 1000);
      lines.push(
        `  ${e.method.padEnd(6)} ${String(e.status).padStart(3)} ${
          e.duration_ms
        }ms x-request-id=${e.request_id ?? "-"} ${e.path} (${age}s ago)`,
      );
    }
    return lines.join("\n");
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(buildBlob());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const errorCount = events.filter((e) => e.status === 0 || e.status >= 400).length;

  return (
    <div
      className="pointer-events-none fixed bottom-2 right-2 z-50 flex flex-col items-end gap-2"
      data-testid="debug-footer"
      // Suppress hydration mismatch warning — pathname/window read
      // after first paint deliberately differs from server render.
      suppressHydrationWarning
    >
      {open && (
        <div className="pointer-events-auto max-w-[480px] rounded-lg border border-border bg-popover p-3 text-xs shadow-lg">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-semibold">Debug</span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={handleCopy}
                className="rounded border bg-background px-2 py-0.5 hover:bg-muted"
              >
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded border bg-background px-2 py-0.5 hover:bg-muted"
              >
                Close
              </button>
            </div>
          </div>
          <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-all rounded border bg-muted/40 p-2 font-mono text-sm">
            {buildBlob()}
          </pre>
          <p className="mt-2 text-sm text-muted-foreground">
            Click <strong>Copy</strong>, paste into a chat with engineering, and
            include what you were trying to do.
          </p>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-popover px-2.5 py-1 text-sm font-medium text-muted-foreground shadow-md hover:bg-muted hover:text-foreground"
        title={open ? "Hide debug panel" : "Open debug panel — click to copy diagnostic info"}
        aria-label={open ? "Hide debug panel" : "Show debug panel"}
      >
        <span
          aria-hidden
          className={
            errorCount > 0
              ? "h-1.5 w-1.5 rounded-full bg-red-500"
              : "h-1.5 w-1.5 rounded-full bg-emerald-500"
          }
        />
        Debug{errorCount > 0 ? ` (${errorCount} err)` : ""}{" "}
        <span className="hidden sm:inline">
          · {(buildSha ?? "—").slice(0, 7)}
        </span>
      </button>
    </div>
  );
}
