"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

// Thin tab primitive — no external dependencies.
// Use for small pill-style tab lists (GIF picker categories, post state filters, etc.).
// Controlled only: pass value + onValueChange from parent state.

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabs(): TabsContextValue {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error("TabTrigger must be rendered inside <Tabs>");
  return ctx;
}

interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
  label?: string;
}

export function Tabs({ value, onValueChange, children, className, label }: TabsProps) {
  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div role="tablist" aria-label={label} className={cn("flex flex-wrap gap-1", className)}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

interface TabTriggerProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "role"> {
  value: string;
}

export function TabTrigger({ value, className, children, ...props }: TabTriggerProps) {
  const ctx = useTabs();
  const isSelected = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isSelected}
      onClick={() => ctx.onValueChange(value)}
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]",
        isSelected
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground hover:bg-muted/80",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
