"use client";

import { Toaster as SonnerToaster } from "sonner";

// ---------------------------------------------------------------------------
// A-6 — Toaster mount.
//
// Wraps sonner's <Toaster /> with project-wide defaults. Mounted once
// in app/admin/layout.tsx; consumers anywhere in the admin tree call
// `import { toast } from "sonner"` and `toast.success("…")` without
// further setup.
//
// Defaults chosen to match Linear / Stripe norms:
//
//   • position: "bottom-right" — out of the way of the operator's
//     primary scan path; doesn't fight the RS-6 cost ticker (also
//     bottom-right but z-40 — sonner uses z-[9999] internally so the
//     toast layers above without collision).
//   • richColors: true — sonner pulls per-variant background tones
//     instead of a single theme.
//   • closeButton: true — operator can dismiss before the auto-close
//     timeout.
//   • duration: 4000ms default — enough to read a sentence, short
//     enough not to linger.
// ---------------------------------------------------------------------------

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      richColors
      closeButton
      duration={4000}
      // Visual class hooks so we can theme via Tailwind tokens later
      // without diving into sonner's internal styles.
      toastOptions={{
        classNames: {
          toast:
            "rounded-md border bg-background text-foreground shadow-lg",
          title: "text-sm font-medium",
          description: "text-sm text-muted-foreground",
        },
      }}
    />
  );
}
