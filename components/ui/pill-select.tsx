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
  "inline-flex items-center justify-between gap-1.5 rounded-full border border-[#1F2937] bg-white font-medium text-[#1F2937] transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";

const SIZE_CLASSES = {
  sm: "px-[14px] py-[6px] text-[13px]",
  default: "px-5 py-[10px] text-[14px]",
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
          className="z-50 min-w-[8rem] overflow-hidden rounded-xl border border-[#E5E7EB] bg-white p-1 shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <ul role="listbox" aria-label={placeholder} className="outline-none">
            {options.map((option) => (
              <li
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                className={cn(
                  "relative flex cursor-pointer select-none items-center rounded-lg px-3 py-1.5 text-[14px] outline-none transition-colors",
                  option.value === value
                    ? "bg-[#00e5a0]/10 font-medium text-[#111827]"
                    : "text-[#374151] hover:bg-[#F3F4F6]",
                )}
                onClick={() => {
                  onValueChange(option.value);
                  setOpen(false);
                }}
              >
                {option.value === value && (
                  <NavIcon name="check" size={14} className="mr-2 shrink-0 text-[#00e5a0]" />
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
