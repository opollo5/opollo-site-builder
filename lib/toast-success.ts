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
  /** Forwarded to sonner. Default ~4s. Set higher for confirmations the operator may want to read. */
  duration?: number;
  /** Forwarded to sonner. Use for de-duplication when the same event may fire repeatedly. */
  id?: string;
}

export function toastSuccess(message: string, options?: ToastSuccessOptions): void {
  toast.success(message, {
    description: options?.description,
    action: options?.action
      ? { label: options.action.label, onClick: options.action.onClick }
      : undefined,
    duration: options?.duration,
    id: options?.id,
  });
}
