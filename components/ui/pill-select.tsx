"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";
import { NavIcon } from "@/components/ui/nav-icon";

// ---------------------------------------------------------------------------
// PillSelect — pill-shaped dropdown selector.
//
// Spec: pill-shaped, secondary variant styling (white bg, #1F2937 border),
// trailing chevron-down icon. Used for workspace selectors, profile filters,
// and any other single-choice dropdown control.
//
// Built on Radix Popover (available) rather than native <select> to allow
// fully custom pill styling across all browsers.
// ---------------------------------------------------------------------------

export interface PillSelectOption {
  value: string;
  label: string;
}

export interface PillSelectProps {
  options: readonly PillSelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** Size maps to canonical Button sizes. Default "sm". */
  size?: "sm" | "default";
}

const TRIGGER_BASE =
  "inline-flex items-center justify-between gap-1.5 rounded-full border border-gray-800 bg-background font-medium text-gray-800 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";

const SIZE_CLASSES = {
  sm: "px-[14px] py-[6px] text-xs",
  default: "px-5 py-[10px] text-sm",
} as const;

export function PillSelect({
  options,
  value,
  onValueChange,
  placeholder = "Select…",
  className,
  size = "sm",
}: PillSelectProps) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((o) => o.value === value);
  const label = selected?.label ?? placeholder;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(TRIGGER_BASE, SIZE_CLASSES[size], className)}
        >
          <span>{label}</span>
          <NavIcon
            name="chevron-down"
            size={14}
            className={cn("shrink-0 transition-transform", open && "rotate-180")}
          />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          className="z-50 min-w-[8rem] overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <ul role="listbox" aria-label={placeholder} className="outline-none">
            {options.map((option) => (
              <li
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                className={cn(
                  "relative flex cursor-pointer select-none items-center rounded-lg px-3 py-1.5 text-sm outline-none transition-colors",
                  option.value === value
                    ? "bg-pk/10 font-medium text-gray-900"
                    : "text-gray-700 hover:bg-gray-100",
                )}
                onClick={() => {
                  onValueChange(option.value);
                  setOpen(false);
                }}
              >
                {option.value === value && (
                  <NavIcon name="check" size={14} className="mr-2 shrink-0 text-pk" />
                )}
                {option.value !== value && (
                  <span className="mr-[22px]" />
                )}
                {option.label}
              </li>
            ))}
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
