"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import {
  clearBreadcrumbs,
  trackClick,
  trackConsole,
  trackFormSubmit,
  trackNetworkRequest,
  trackRoute,
} from "@/components/error-reporting/breadcrumb-buffer";
import { isErrorReportingEnabled } from "@/lib/error-reporting/flag";
import { scrubUrl } from "@/lib/error-reporting/scrubber";

// ---------------------------------------------------------------------------
// BreadcrumbProvider — mounts once in the platform layout.
//
// Instruments: route changes, clicks, network requests (fetch proxy), form
// submits, and console errors/warnings. All instrumentation is a no-op when
// OPOLLO_ERROR_REPORTING_ENABLED is off. Tears down cleanly on unmount.
// ---------------------------------------------------------------------------

export function BreadcrumbProvider() {
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);

  // Track route changes via pathname changes.
  useEffect(() => {
    if (!isErrorReportingEnabled()) return;
    const current = pathname ?? "";
    if (current !== pathnameRef.current) {
      trackRoute(current);
      pathnameRef.current = current;
    }
  }, [pathname]);

  // Wire all browser listeners once on mount.
  useEffect(() => {
    if (!isErrorReportingEnabled()) return;

    // Seed the initial route.
    trackRoute(pathnameRef.current ?? "");

    // ------------------------------------------------------------------
    // Click tracking
    // ------------------------------------------------------------------
    const onClickCapture = (e: MouseEvent) => trackClick(e.target);
    document.addEventListener("click", onClickCapture, { capture: true });

    // ------------------------------------------------------------------
    // Form submit tracking
    // ------------------------------------------------------------------
    const onSubmitCapture = (e: SubmitEvent) => {
      if (e.target instanceof HTMLFormElement) trackFormSubmit(e.target);
    };
    document.addEventListener("submit", onSubmitCapture, { capture: true });

    // ------------------------------------------------------------------
    // Fetch proxy — captures method, URL, status, duration. No bodies.
    // ------------------------------------------------------------------
    const origFetch = window.fetch;
    window.fetch = async function patchedFetch(input, init) {
      const method = (init?.method ?? "GET").toUpperCase();
      const url = scrubUrl(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const start = Date.now();
      try {
        const response = await origFetch(input, init);
        trackNetworkRequest(method, url, response.status, Date.now() - start);
        return response;
      } catch (err) {
        trackNetworkRequest(method, url, 0, Date.now() - start);
        throw err;
      }
    };

    // ------------------------------------------------------------------
    // Console monkey-patch
    // ------------------------------------------------------------------
    const origError = console.error.bind(console);
    const origWarn = console.warn.bind(console);

    console.error = (...args: unknown[]) => {
      trackConsole("console_error", args.map(String).join(" "));
      origError(...args);
    };
    console.warn = (...args: unknown[]) => {
      trackConsole("console_warn", args.map(String).join(" "));
      origWarn(...args);
    };

    return () => {
      document.removeEventListener("click", onClickCapture, { capture: true });
      document.removeEventListener("submit", onSubmitCapture, { capture: true });
      window.fetch = origFetch;
      console.error = origError;
      console.warn = origWarn;
      clearBreadcrumbs();
    };
  }, []);

  return null;
}
