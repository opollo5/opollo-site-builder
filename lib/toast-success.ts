"use client";

import { toast } from "sonner";

// Spec 08 — Tier 2 toast standardisation.
//
// Wraps toast.success with consistent shape: subject + optional description
// + optional CTA. Action label uses "→" not "🎉" per brief (no emojis in
// success copy).
//
// Use for subsequent publishes / saves / single-item creations / social-
// account connections after the first.

export interface ToastSuccessOptions {
  description?: string;
  action?: { label: string; onClick: () => void };
}

export function toastSuccess(message: string, options?: ToastSuccessOptions): void {
  toast.success(message, {
    description: options?.description,
    action: options?.action
      ? { label: options.action.label, onClick: options.action.onClick }
      : undefined,
  });
}
