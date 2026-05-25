"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { Connection } from "@/lib/social/types";
import { ProfileChip } from "@/components/social/profile-chip";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ---------------------------------------------------------------------------
// Composer ProfileSelector — chip row + "Add profile" affordance.
// Controlled component: caller owns selected[] + onChange.
// ---------------------------------------------------------------------------

export interface ProfileSelectorProps {
  available: Connection[];
  selected: string[];
  onChange: (ids: string[]) => void;
  className?: string;
  /**
   * Hide the "Add profile" affordance and disable chip toggling.
   * Used in read-only composer states (state='published' etc.).
   */
  readOnly?: boolean;
}

export function ProfileSelector({ available, selected, onChange, className, readOnly = false }: ProfileSelectorProps) {
  function toggle(id: string) {
    if (readOnly) return;
    if (selected.includes(id)) {
      onChange(selected.filter((x) => x !== id));
    } else {
      onChange([...selected, id]);
    }
  }

  const hasSelected = selected.length > 0;

  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)} data-testid="profile-selector">
      <TooltipProvider delayDuration={300}>
        {available.map((conn) => {
          const chip = (
            <ProfileChip
              key={conn.id}
              id={conn.id}
              name={conn.account_name}
              platform={conn.platform}
              avatarUrl={conn.account_avatar_url}
              selected={selected.includes(conn.id)}
              onClick={() => toggle(conn.id)}
            />
          );
          if (hasSelected) return chip;
          return (
            <Tooltip key={conn.id}>
              <TooltipTrigger asChild>{chip}</TooltipTrigger>
              <TooltipContent side="bottom" data-testid={`chip-tooltip-${conn.id}`} forceMount>
                Click to select
              </TooltipContent>
            </Tooltip>
          );
        })}
      </TooltipProvider>

      {/* "Add profile" chip — links to connection settings (edit-mode only) */}
      {!readOnly && (
        <a
          href="/company/social/connections"
          aria-label="Add profile"
          data-testid="connections-connect-button"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </a>
      )}

      {!readOnly && hasSelected && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="ml-1 text-xs text-muted-foreground hover:text-foreground underline"
        >
          Deselect all
        </button>
      )}
    </div>
  );
}
