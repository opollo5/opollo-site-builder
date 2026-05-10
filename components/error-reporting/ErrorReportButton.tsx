"use client";

import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { NavIcon } from "@/components/ui/nav-icon";
import { isErrorReportingEnabled } from "@/lib/error-reporting/flag";
import type { ErrorContext } from "@/lib/error-reporting/types";
import { assembleErrorReport } from "@/components/error-reporting/context-collector";
import { ErrorReportModal } from "@/components/error-reporting/ErrorReportModal";

// ---------------------------------------------------------------------------
// ErrorReportButton — small outlined button wired to ErrorReportModal.
//
// Rendered inside (or next to) every error surface. Invisible when the
// OPOLLO_ERROR_REPORTING_ENABLED flag is off.
//
// Context is assembled at click time rather than at render time so we
// capture the most current breadcrumbs.
// ---------------------------------------------------------------------------

interface ErrorReportButtonProps {
  context: ErrorContext;
  className?: string;
}

export function ErrorReportButton({ context, className }: ErrorReportButtonProps) {
  const [open, setOpen] = useState(false);

  // Assemble the report lazily so we capture breadcrumbs at click time.
  const report = useMemo(() => {
    if (!open) return null;
    return assembleErrorReport(context);
  }, [open, context]);

  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);

  if (!isErrorReportingEnabled()) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={className}
        onClick={handleOpen}
        aria-label="Report to admin"
      >
        <NavIcon name="bug" size={14} className="mr-1.5" />
        Report to admin
      </Button>

      {open && report && (
        <ErrorReportModal open={open} onClose={handleClose} report={report} />
      )}
    </>
  );
}
