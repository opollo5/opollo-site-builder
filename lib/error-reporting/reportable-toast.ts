// ---------------------------------------------------------------------------
// reportableToast — wraps sonner toast.error() / toast.warning() to
// optionally include a "Report to admin" action when error reporting is on.
//
// Usage:
//   reportableToast.error("Save failed", { message: "Save failed", stack: err.stack })
//   reportableToast.error("Save failed")  // no context → no report button
//
// The action button triggers the ErrorReportModal from within the toast.
// ---------------------------------------------------------------------------

import { toast, type ExternalToast } from "sonner";

import { isErrorReportingEnabled } from "@/lib/error-reporting/flag";
import type { ErrorContext } from "@/lib/error-reporting/types";

// Lazily import the modal launcher to avoid pulling React + client code into
// server bundles that import this helper. The import is inside the action
// callback, which only runs in the browser.
async function openReportModal(context: ErrorContext): Promise<void> {
  const { showErrorReport } = await import("@/components/error-reporting/showErrorReport");
  showErrorReport(context);
}

function buildAction(
  context: ErrorContext | undefined,
): Pick<ExternalToast, "action"> {
  if (!context || !isErrorReportingEnabled()) return {};
  return {
    action: {
      label: "Report to admin",
      onClick: () => void openReportModal(context),
    },
  };
}

export const reportableToast = {
  error(message: string, context?: ErrorContext, opts?: ExternalToast): void {
    toast.error(message, { ...opts, ...buildAction(context) });
  },
  warning(message: string, context?: ErrorContext, opts?: ExternalToast): void {
    toast.warning(message, { ...opts, ...buildAction(context) });
  },
};
