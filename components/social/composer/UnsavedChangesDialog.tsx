"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export interface UnsavedChangesDialogProps {
  open: boolean;
  onDiscard: () => void;
  onCancel: () => void;
  /** When provided, renders a "Save" primary button that saves before closing. */
  onSave?: () => void | Promise<void>;
}

export function UnsavedChangesDialog({ open, onDiscard, onCancel, onSave }: UnsavedChangesDialogProps) {
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Do you want to save your changes?</DialogTitle>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {onSave && (
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              data-testid="unsaved-save-btn"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="w-full rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            data-testid="unsaved-continue-btn"
          >
            Continue editing
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="w-full px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            data-testid="unsaved-discard-btn"
          >
            Don&apos;t save
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
