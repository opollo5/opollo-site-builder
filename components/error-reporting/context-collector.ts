// ---------------------------------------------------------------------------
// Context collector — assembles the full ErrorReport payload at click time.
// Client-side only (uses window, navigator, document).
// ---------------------------------------------------------------------------

import type { ErrorContext, ErrorReport } from "@/lib/error-reporting/types";
import { scrubPayload, scrubUrl } from "@/lib/error-reporting/scrubber";
import {
  getBreadcrumbs,
  getRouteHistory,
} from "@/components/error-reporting/breadcrumb-buffer";

export function assembleErrorReport(
  context: ErrorContext,
  userDescription?: string,
): ErrorReport {
  const nav = typeof navigator !== "undefined" ? navigator : null;
  const win = typeof window !== "undefined" ? window : null;

  const viewport = win
    ? `${win.innerWidth}×${win.innerHeight}`
    : "unknown";

  const browser = nav?.userAgent ?? "unknown";
  const locale = nav?.language ?? "unknown";
  const timezone = Intl?.DateTimeFormat?.().resolvedOptions?.()?.timeZone ?? "unknown";

  const currentUrl = scrubUrl(win?.location?.href ?? "");
  const previousUrl = document.referrer ? scrubUrl(document.referrer) : undefined;

  const report: ErrorReport = {
    gitSha: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    browser,
    viewport,
    locale,
    timezone,
    timestamp: new Date().toISOString(),
    currentUrl,
    previousUrl,
    routeHistory: getRouteHistory(),
    errorMessage: context.message,
    errorType: context.type,
    stack: context.stack,
    componentStack: context.componentStack,
    apiCall: context.apiCall,
    dbErrorCode: context.dbErrorCode,
    breadcrumbs: getBreadcrumbs(),
    stateSlice: context.stateSlice,
    userDescription: userDescription?.trim() || undefined,
  };

  return scrubPayload(report);
}
