"use client";

import { useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ---------------------------------------------------------------------------
// Reusable confirm / comment dialogs — replaces window.confirm() and
// window.prompt() throughout the social platform (S-6).
//
// ConfirmDialog:  simple "Are you sure?" with confirm + cancel buttons.
// CommentDialog:  same but with an optional <textarea> for a reason/note.
// ---------------------------------------------------------------------------

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  confirmVariant?: "default" | "destructive" | "outline" | "ghost";
  onConfirm: () => void;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  confirmVariant = "default",
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={confirmVariant}
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type CommentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  commentLabel?: string;
  commentPlaceholder?: string;
  confirmLabel?: string;
  confirmVariant?: "default" | "destructive" | "outline" | "ghost";
  onConfirm: (comment: string) => void;
};

export function CommentDialog({
  open,
  onOpenChange,
  title,
  description,
  commentLabel = "Note (optional)",
  commentPlaceholder = "Add a note…",
  confirmLabel = "Confirm",
  confirmVariant = "default",
  onConfirm,
}: CommentDialogProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <div>
          <label className="block text-sm font-medium" htmlFor="comment-dialog-input">
            {commentLabel}
          </label>
          <textarea
            id="comment-dialog-input"
            ref={ref}
            rows={3}
            placeholder={commentPlaceholder}
            className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={confirmVariant}
            onClick={() => {
              const comment = ref.current?.value.trim() ?? "";
              onOpenChange(false);
              onConfirm(comment);
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
