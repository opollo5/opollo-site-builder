"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SocialPlatformIcon, type SocialPlatformIconKey } from "@/components/ui/SocialPlatformIcon";

// ---------------------------------------------------------------------------
// AddProfileDropdown — "Add profile" button + platform picker.
// Brief audit gap G-3 (C-2 in original audit): dashboard FilterBar needs an
// affordance to connect additional social profiles.
//
// Route: each item links to /company/social/connections, which is the
// canonical profile-connection management page. The brief specifies
// /company/social/connections/connect/[platform] but that route does not
// exist; the connections page opens the platform OAuth popup from there.
// ---------------------------------------------------------------------------

const PLATFORMS: Array<{ value: SocialPlatformIconKey; label: string }> = [
  { value: "LINKEDIN", label: "LinkedIn" },
  { value: "FACEBOOK", label: "Facebook" },
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "TWITTER", label: "X (Twitter)" },
  { value: "GOOGLE_BUSINESS", label: "Google Business" },
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
        data-testid="add-profile-btn"
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
            {PLATFORMS.map(({ value, label }) => (
              <Link
                key={value}
                href="/company/social/connections"
                role="menuitem"
                data-testid={`add-profile-${value.toLowerCase()}`}
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted transition-colors"
              >
                <SocialPlatformIcon platform={value} size={16} className="shrink-0" />
                {label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
