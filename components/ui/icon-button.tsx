import * as React from "react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// IconButton — 32×32 circular icon-only control.
//
// Spec: fully rounded pill (9999px), transparent background, hover
// bg-[#F3F4F6]. Must always carry an accessible label (aria-label or
// aria-labelledby). Always pair with a visible text label where space
// allows; this component is for space-constrained controls only (‹ ›,
// close, overflow).
// ---------------------------------------------------------------------------

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
}

export const IconButton = React.forwardRef<
  HTMLButtonElement,
  IconButtonProps
>(({ label, className, children, ...props }, ref) => {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-full",
        "bg-transparent text-[#374151] transition-colors",
        "hover:bg-[#F3F4F6]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});
IconButton.displayName = "IconButton";
