"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SocialPlatformIcon, type SocialPlatformIconKey } from "@/components/ui/SocialPlatformIcon";

// ---------------------------------------------------------------------------
// AddProfileDropdown — "Add profile" button + platform picker.
// Brief audit gap C-1 (hardening spec) / C-2/G-3 (original audit).
// Each item links to /company/social/connections/connect/[platform]; that
// route is a redirect stub back to the connections page where the actual
// bundle.social OAuth popup is initiated.
// ---------------------------------------------------------------------------

// CLAUDE-ASSUMPTION (PR 1.1): /company/social/connections/connect/[platform] is a
// redirect stub because the real connect flow is popup-based via POST
// /api/platform/social/connections/connect. Logged in DECISION_TRAIL.md.
const PLATFORMS: Array<{ value: string; icon: SocialPlatformIconKey; label: string; isNew?: boolean }> = [
  { value: "linkedin", icon: "LINKEDIN", label: "LinkedIn" },
  { value: "facebook", icon: "FACEBOOK", label: "Facebook" },
  { value: "instagram", icon: "INSTAGRAM", label: "Instagram" },
  { value: "x", icon: "TWITTER", label: "X (Twitter)" },
  { value: "tiktok", icon: "TIKTOK", label: "TikTok", isNew: true },
  { value: "google_business_profile", icon: "GOOGLE_BUSINESS", label: "Google Business Profile" },
];

interface AddProfileDropdownProps {
  className?: string;
}

export function AddProfileDropdown({ className }: AddProfileDropdownProps) {
  const [open, setOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className={cn("relative", className)} ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add profile"
        data-testid="add-profile-trigger"
        className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add profile
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="opacity-50"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Choose platform to connect"
          data-testid="add-profile-menu"
          className="absolute left-0 top-full z-20 mt-1 w-52 rounded-lg border border-border bg-popover shadow-lg"
        >
          <div className="p-1">
            {PLATFORMS.map(({ value, icon, label, isNew }) => (
              <Link
                key={value}
                href={`/company/social/connections/connect/${value}`}
                role="menuitem"
                data-testid={`add-profile-${value}`}
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted transition-colors"
              >
                <SocialPlatformIcon platform={icon} size={16} className="shrink-0" />
                <span className="flex-1">{label}</span>
                {isNew && (
                  <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary leading-none">
                    New
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
