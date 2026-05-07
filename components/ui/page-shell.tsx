import * as React from "react";

import { cn } from "@/lib/utils";

// Spec 02 §1.3 — PageShell layout primitive.
//
// Pairs with PageHeader to enforce consistent admin-page chrome:
//   - Max width: 1280px (max-w-7xl).
//     Audit run on 2026-05-07: max-w-5xl (9 files), max-w-4xl (6),
//     max-w-3xl (5), max-w-2xl (5), max-w-7xl (2), max-w-xl (1).
//     No single value exceeds 60% of files, so per the spec algorithm
//     we land on the locked 1280px default.
//   - Horizontal padding: 32px desktop (lg+), 24px tablet (sm+), 16px
//     mobile.
//   - PageHeader.bottom margin → PageShell.Content begins (header
//     primitive owns the 32px gap; shell just provides the frame).
//
// PageShell.Content has zero inner padding — pages own their grid.

export interface PageShellProps {
  children: React.ReactNode;
  className?: string;
}

export function PageShell({ children, className }: PageShellProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8",
        className,
      )}
    >
      {children}
    </div>
  );
}

function PageShellContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn(className)}>{children}</div>;
}
PageShellContent.displayName = "PageShellContent";

PageShell.Content = PageShellContent;
