"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { Connection } from "@/lib/social/types";
import { SocialPlatformIcon, type SocialPlatformIconKey } from "@/components/ui/SocialPlatformIcon";
import { AddProfileDropdown } from "@/components/social/dashboard/AddProfileDropdown";

interface FilterBarProps {
  profileFilter: string[];
  onProfileFilterChange: (ids: string[]) => void;
  viewMode: "month" | "timeline";
  onViewModeChange: (mode: "month" | "timeline") => void;
  availableConnections: Connection[];
  onNewPost: () => void;
  onBulkUpload: () => void;
  className?: string;
}

export function FilterBar({
  profileFilter,
  onProfileFilterChange,
  viewMode,
  onViewModeChange,
  availableConnections,
  onNewPost,
  onBulkUpload,
  className,
}: FilterBarProps) {
  const [profileMenuOpen, setProfileMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    }
    if (profileMenuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [profileMenuOpen]);

  const profileLabel =
    profileFilter.length === 0
      ? "All profiles"
      : profileFilter.length === 1
      ? availableConnections.find((c) => c.id === profileFilter[0])?.account_name ?? "1 profile"
      : `${profileFilter.length} profiles`;

  function toggleProfile(id: string) {
    if (profileFilter.includes(id)) {
      onProfileFilterChange(profileFilter.filter((p) => p !== id));
    } else {
      onProfileFilterChange([...profileFilter, id]);
    }
  }

  return (
    <div
      className={cn("flex flex-wrap items-center gap-2 border-b border-border px-4 py-2", className)}
      data-testid="filter-bar"
    >
      {/* New post + bulk button group */}
      <div className="flex">
        <button
          type="button"
          onClick={onNewPost}
          className="flex items-center gap-1.5 rounded-l-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          data-testid="new-post-btn"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          New post
        </button>
        <button
          type="button"
          aria-label="Bulk schedule"
          onClick={onBulkUpload}
          className="flex items-center justify-center rounded-r-md border-l border-primary/30 bg-primary px-2.5 py-1.5 text-primary-foreground hover:bg-primary/90 transition-colors"
          data-testid="bulk-upload-btn"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect width="14" height="14" x="8" y="8" rx="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
          </svg>
        </button>
      </div>

      {/* Profile filter */}
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setProfileMenuOpen((o) => !o)}
          className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors min-w-[130px]"
          data-testid="profile-filter-btn"
          aria-haspopup="listbox"
          aria-expanded={profileMenuOpen}
        >
          <span className="flex-1 text-left">{profileLabel}</span>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="opacity-50">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {profileMenuOpen && (
          <div
            role="listbox"
            aria-label="Filter by profile"
            className="absolute left-0 top-full z-20 mt-1 w-60 rounded-lg border border-border bg-popover shadow-lg"
            data-testid="profile-filter-menu"
          >
            <div className="p-1">
              <button
                type="button"
                role="option"
                aria-selected={profileFilter.length === 0}
                onClick={() => { onProfileFilterChange([]); setProfileMenuOpen(false); }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left",
                  profileFilter.length === 0 ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted",
                )}
              >
                All profiles
              </button>
              {availableConnections.map((conn) => {
                const iconKey = conn.platform.toUpperCase().replace("GOOGLE_BUSINESS_PROFILE", "GOOGLE_BUSINESS") as SocialPlatformIconKey;
                const selected = profileFilter.includes(conn.id);
                return (
                  <button
                    key={conn.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => toggleProfile(conn.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left",
                      selected ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted",
                    )}
                  >
                    <SocialPlatformIcon platform={iconKey} size={15} className="shrink-0" />
                    <span className="truncate">{conn.account_name}</span>
                    {selected && (
                      <svg className="ml-auto h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Add profile — only shown when at least one connection exists; empty state handles zero-connection flow */}
      {availableConnections.length > 0 && <AddProfileDropdown />}

      {/* View mode toggle (Month / Timeline) */}
      <div
        className="ml-auto flex rounded-md border border-border bg-background text-sm"
        role="group"
        aria-label="View mode"
        data-testid="view-mode-toggle"
      >
        <button
          type="button"
          onClick={() => onViewModeChange("month")}
          aria-pressed={viewMode === "month"}
          className={cn(
            "rounded-l-md px-3 py-1.5 text-sm font-medium transition-colors",
            viewMode === "month"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted",
          )}
          data-testid="view-month-btn"
        >
          Month
        </button>
        <button
          type="button"
          onClick={() => onViewModeChange("timeline")}
          aria-pressed={viewMode === "timeline"}
          className={cn(
            "rounded-r-md border-l border-border px-3 py-1.5 text-sm font-medium transition-colors",
            viewMode === "timeline"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted",
          )}
          data-testid="view-timeline-btn"
        >
          Timeline
        </button>
      </div>
    </div>
  );
}
