"use client";

import Link from "next/link";

import { NavIcon } from "@/components/ui/nav-icon";

type Props = {
  activeView: "calendar" | "posts";
};

export function SocialViewToggle({ activeView }: Props) {
  return (
    <div
      className="flex items-center overflow-hidden rounded-lg border border-white/[0.1]"
      role="group"
      aria-label="View mode"
      data-testid="social-view-toggle"
    >
      {activeView === "calendar" ? (
        <span
          aria-current="page"
          className="flex items-center gap-1.5 border-r border-white/[0.1] bg-pk px-3 py-1.5 text-sm text-white"
        >
          <NavIcon name="calendar-full" size={14} />
          Calendar
        </span>
      ) : (
        <Link
          href="/company/social/calendar"
          className="flex items-center gap-1.5 border-r border-white/[0.1] px-3 py-1.5 text-sm text-m2 transition-colors hover:bg-white/[0.05] hover:text-white"
        >
          <NavIcon name="calendar-full" size={14} />
          Calendar
        </Link>
      )}

      {activeView === "posts" ? (
        <span
          aria-current="page"
          className="flex items-center gap-1.5 border-r border-white/[0.1] bg-pk px-3 py-1.5 text-sm text-white"
        >
          <NavIcon name="list" size={14} />
          Posts
        </span>
      ) : (
        <Link
          href="/company/social/posts"
          className="flex items-center gap-1.5 border-r border-white/[0.1] px-3 py-1.5 text-sm text-m2 transition-colors hover:bg-white/[0.05] hover:text-white"
        >
          <NavIcon name="list" size={14} />
          Posts
        </Link>
      )}

      <button
        disabled
        aria-disabled="true"
        title="Coming soon"
        className="flex cursor-not-allowed items-center gap-1.5 px-3 py-1.5 text-sm text-m3 opacity-40"
      >
        <NavIcon name="clock" size={14} />
        Timeline
      </button>
    </div>
  );
}
