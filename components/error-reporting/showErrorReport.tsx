"use client";

// ---------------------------------------------------------------------------
// showErrorReport — imperative trigger for the error report modal.
//
// Used by reportableToast when the "Report to admin" toast action is clicked.
// Mounts a standalone modal into a transient DOM container so it works
// outside the React tree where the toast action callback fires.
// ---------------------------------------------------------------------------

import { createRoot } from "react-dom/client";

import type { ErrorContext } from "@/lib/error-reporting/types";
import { assembleErrorReport } from "@/components/error-reporting/context-collector";
import { ErrorReportModal } from "@/components/error-reporting/ErrorReportModal";

export function showErrorReport(context: ErrorContext): void {
  const report = assembleErrorReport(context);

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  function cleanup() {
    root.unmount();
    container.remove();
  }

  root.render(
    <ErrorReportModal
      open
      onClose={cleanup}
      report={report}
    />,
  );
}
