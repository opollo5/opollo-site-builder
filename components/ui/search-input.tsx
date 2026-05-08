import * as React from "react";

import { cn } from "@/lib/utils";
import { NavIcon } from "@/components/ui/nav-icon";

// ---------------------------------------------------------------------------
// SearchInput — pill-shaped search field.
//
// Spec: rounded-full, 1px border #E5E7EB (gray-200), 12px horizontal padding
// (px-3), leading search icon. The submit control (if any) must be a
// canonical <Button variant="default" size="sm"> — never a bare text link.
// ---------------------------------------------------------------------------

export interface SearchInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Accessible wrapper label; defaults to "Search". */
  label?: string;
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ label = "Search", className, ...props }, ref) => {
    return (
      <div className="relative flex items-center">
        <NavIcon
          name="magnifier"
          size={16}
          className="pointer-events-none absolute left-3 text-[#9CA3AF]"
        />
        <input
          ref={ref}
          type="search"
          aria-label={props["aria-label"] ?? label}
          className={cn(
            "h-9 w-full rounded-full border border-[#E5E7EB] bg-white pl-9 pr-3",
            "text-[14px] text-[#111827] placeholder:text-[#9CA3AF]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            "disabled:pointer-events-none disabled:opacity-50",
            className,
          )}
          {...props}
        />
      </div>
    );
  },
);
SearchInput.displayName = "SearchInput";
