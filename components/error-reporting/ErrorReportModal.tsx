"use client";

import { useCallback, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

import { Button } from "@/components/ui/button";
import { NavIcon } from "@/components/ui/nav-icon";
import { cn } from "@/lib/utils";
import type { ErrorReport } from "@/lib/error-reporting/types";

// ---------------------------------------------------------------------------
// ErrorReportModal — opened by ErrorReportButton.
//
// Three states: idle → sending → sent | error.
// Idempotent: double-clicking Send is a no-op while the request is in flight.
// ---------------------------------------------------------------------------

interface ErrorReportModalProps {
  open: boolean;
  onClose: () => void;
  report: ErrorReport;
}

type SendState = "idle" | "sending" | "sent" | "error";

export function ErrorReportModal({ open, onClose, report }: ErrorReportModalProps) {
  const [description, setDescription] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sendState, setSendState] = useState<SendState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const sendingRef = useRef(false);

  const handleSend = useCallback(async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSendState("sending");
    setErrorMessage(null);

    try {
      const payload: ErrorReport = { ...report, userDescription: description.trim() || undefined };
      const res = await fetch("/api/internal/error-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      });
      const json = (await res.json()) as { ok: boolean; error?: { message?: string } };
      if (!res.ok || !json.ok) {
        setSendState("error");
        setErrorMessage(json.error?.message ?? "Unknown error. Please try again.");
      } else {
        setSendState("sent");
      }
    } catch {
      setSendState("error");
      setErrorMessage("Network error. Please check your connection and try again.");
    } finally {
      sendingRef.current = false;
    }
  }, [report, description]);

  const handleRetry = useCallback(() => {
    setSendState("idle");
    setErrorMessage(null);
    sendingRef.current = false;
  }, []);

  const handleClose = useCallback(() => {
    setSendState("idle");
    setDescription("");
    setPreviewOpen(false);
    setErrorMessage(null);
    sendingRef.current = false;
    onClose();
  }, [onClose]);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-[50%] top-[50%] z-50 w-full max-w-md translate-x-[-50%] translate-y-[-50%] rounded-lg border bg-background p-6 shadow-xl focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]"
          aria-describedby="error-report-description"
        >
          <div className="flex items-start justify-between gap-2">
            <Dialog.Title className="text-sm font-semibold">
              Report issue to admin
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                aria-label="Close report dialog"
                className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <NavIcon name="cross" size={16} />
              </button>
            </Dialog.Close>
          </div>

          {sendState === "sent" ? (
            <div className="mt-4 flex flex-col items-center gap-3 py-4 text-center">
              <NavIcon name="checkmark-circle" size={32} className="text-success" />
              <p className="text-sm font-medium">Report sent</p>
              <p className="text-xs text-muted-foreground">
                The admin has been notified and will investigate.
              </p>
              <Button size="sm" variant="outline" onClick={handleClose}>
                Close
              </Button>
            </div>
          ) : (
            <>
              <p id="error-report-description" className="mt-2 text-xs text-muted-foreground">
                This sends a technical report to the Opollo admin so they can
                diagnose and fix the issue. Don&apos;t paste passwords or secrets —
                this email goes to the admin.
              </p>

              <div className="mt-4">
                <label htmlFor="error-report-description-input" className="text-xs font-medium">
                  What were you trying to do?{" "}
                  <span className="text-muted-foreground">(optional)</span>
                </label>
                <textarea
                  id="error-report-description-input"
                  className="mt-1 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                  rows={3}
                  placeholder="e.g. I was trying to save a new post when this happened."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={1000}
                  disabled={sendState === "sending"}
                />
              </div>

              <details className="mt-3" open={previewOpen} onToggle={(e) => setPreviewOpen((e.target as HTMLDetailsElement).open)}>
                <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
                  {previewOpen ? "Hide" : "Show"} what will be sent
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto rounded border bg-muted/40 p-2 text-[10px] text-muted-foreground">
                  {JSON.stringify(report, null, 2)}
                </pre>
              </details>

              {sendState === "error" && errorMessage && (
                <p className="mt-3 text-xs text-destructive" role="alert">
                  {errorMessage}
                </p>
              )}

              <div className="mt-4 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={handleClose} disabled={sendState === "sending"}>
                  Cancel
                </Button>
                {sendState === "error" ? (
                  <Button size="sm" variant="outline" onClick={handleRetry}>
                    <NavIcon name="redo" size={14} className="mr-1.5" />
                    Try again
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={handleSend}
                    disabled={sendState === "sending"}
                  >
                    {sendState === "sending" ? (
                      <>
                        <NavIcon name="sync" size={14} className={cn("mr-1.5", sendState === "sending" && "animate-spin")} />
                        Sending…
                      </>
                    ) : (
                      <>
                        <NavIcon name="envelope" size={14} className="mr-1.5" />
                        Send report
                      </>
                    )}
                  </Button>
                )}
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
