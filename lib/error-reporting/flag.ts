// Feature gate for the error-reporting subsystem.
//
// Next.js only inlines NEXT_PUBLIC_* env vars into the client bundle, so the
// PREFIXED name is what gates the UI (Alert "Report to admin" button,
// reportableToast action, BreadcrumbProvider instrumentation). The
// non-prefixed legacy name is kept as a server-side fallback during the
// transition — set both in Vercel to flip the feature on cleanly.
export function isErrorReportingEnabled(): boolean {
  const v =
    process.env.NEXT_PUBLIC_OPOLLO_ERROR_REPORTING_ENABLED ??
    process.env.OPOLLO_ERROR_REPORTING_ENABLED;

  // Dev-only diagnostic: catches the misconfiguration where someone sets
  // OPOLLO_ERROR_REPORTING_ENABLED in Vercel but forgets the NEXT_PUBLIC_
  // twin. Server-side the legacy var still works, but client-side the
  // Report-to-admin button stays invisible — silently.
  if (
    typeof window !== "undefined" &&
    process.env.NODE_ENV !== "production" &&
    !process.env.NEXT_PUBLIC_OPOLLO_ERROR_REPORTING_ENABLED
  ) {
    const w = window as Window & { __opolloErrorReportingMisconfigWarned?: boolean };
    if (!w.__opolloErrorReportingMisconfigWarned) {
      w.__opolloErrorReportingMisconfigWarned = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[error-reporting] NEXT_PUBLIC_OPOLLO_ERROR_REPORTING_ENABLED is not set " +
          "in the client bundle. If OPOLLO_ERROR_REPORTING_ENABLED is set in " +
          "Vercel, add the NEXT_PUBLIC_ twin and rebuild — otherwise the " +
          "Report-to-admin button never renders in the browser.",
      );
    }
  }

  return v === "true" || v === "1";
}
