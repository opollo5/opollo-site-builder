"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const REASONS = [
  { value: "not_relevant", label: "Not relevant to my business" },
  { value: "tried_before", label: "Already tried this" },
  { value: "brand_mismatch", label: "Doesn't match my brand" },
  { value: "other", label: "Other" },
] as const;

type Reason = (typeof REASONS)[number]["value"];

interface DismissalModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: Reason, notes: string) => Promise<void>;
  headline: string;
}

export function DismissalModal({ open, onClose, onConfirm, headline }: DismissalModalProps) {
  const [reason, setReason] = useState<Reason | "">("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!reason) return;
    setSubmitting(true);
    try {
      await onConfirm(reason, notes);
      setReason("");
      setNotes("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="dismissal-modal">
        <DialogHeader>
          <DialogTitle className="text-tx-primary">Dismiss recommendation</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-tx-secondary line-clamp-2">{headline}</p>

        <div className="space-y-2 pt-1">
          <p className="text-sm font-medium text-tx-primary">Why are you dismissing this?</p>
          <div className="space-y-2">
            {REASONS.map((r) => (
              <label
                key={r.value}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-b2 p-3 hover:border-pk transition-colors"
                data-testid={`reason-${r.value}`}
              >
                <input
                  type="radio"
                  name="dismiss-reason"
                  value={r.value}
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)}
                  className="accent-pk"
                />
                <span className="text-sm text-tx-primary">{r.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="dismiss-notes" className="text-sm text-tx-secondary">
            Optional notes
          </label>
          <Textarea
            id="dismiss-notes"
            placeholder="Anything else we should know?"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="resize-none"
            data-testid="dismiss-notes"
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!reason || submitting}
            data-testid="dismiss-confirm"
          >
            {submitting ? "Dismissing…" : "Dismiss"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
