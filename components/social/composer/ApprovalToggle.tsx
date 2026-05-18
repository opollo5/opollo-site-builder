"use client";

import * as React from "react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export interface ApprovalToggleProps {
  value: boolean;
  onChange: (v: boolean) => void;
  className?: string;
}

export function ApprovalToggle({ value, onChange, className }: ApprovalToggleProps) {
  const id = React.useId();
  return (
    <div className={cn("flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-4 py-3", className)}>
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-sm font-medium text-foreground cursor-pointer">
          Post needs approval
        </label>
        <p className="text-xs text-muted-foreground">
          The approver will receive an email with a review link before this post goes live.
        </p>
      </div>
      <Switch
        id={id}
        checked={value}
        onCheckedChange={onChange}
        label="Post needs approval"
      />
    </div>
  );
}
