"use client";

import * as React from "react";
import {
  MessageCircle,
  Repeat2,
  Heart,
  BarChart2,
  Bookmark,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// XPreviewCard — visual mock of an X (Twitter) post (Phase 3.3 / B3)
//
// Matches wireframe State 09 (X section): 40px avatar, name bold + @handle
// muted + relative time; body; image 16:9 with 16px radius; 5-action row.
// 280-char counter turns danger-red on overflow.
// ---------------------------------------------------------------------------

export interface XPreviewProfile {
  name: string;
  avatarUrl?: string | null;
  handle?: string;
}

export interface XPreviewCardProps {
  profile: XPreviewProfile;
  content: string;
  media?: string[];
  className?: string;
}

const X_CHAR_LIMIT = 280;
const X_BG = "#000000";

function AvatarX({ profile }: { profile: XPreviewProfile }) {
  const initials =
    profile.name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";

  return (
    <div className="h-10 w-10 shrink-0 rounded-full overflow-hidden" data-testid="x-preview-avatar">
      {profile.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={profile.avatarUrl} alt={profile.name} className="h-full w-full object-cover" />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center text-sm font-semibold text-white"
          style={{ backgroundColor: X_BG }}
        >
          {initials}
        </div>
      )}
    </div>
  );
}

function StatButton({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex items-center gap-1 text-xs text-gray-500 hover:text-sky-500 transition-colors"
    >
      <Icon size={16} strokeWidth={1.75} />
    </button>
  );
}

export function XPreviewCard({ profile, content, media = [], className }: XPreviewCardProps) {
  const handle = profile.handle ?? "@" + profile.name.toLowerCase().replace(/\s+/g, "");
  const displayHandle = handle.startsWith("@") ? handle : "@" + handle;
  const charCount = content.length;
  const isOverLimit = charCount > X_CHAR_LIMIT;
  const truncated = isOverLimit ? content.slice(0, X_CHAR_LIMIT) + "…" : content;
  const firstImage = media[0];

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-white text-sm shadow-sm",
        className,
      )}
      data-testid="x-preview-card"
    >
      <div className="flex gap-3 p-4">
        <AvatarX profile={profile} />
        <div className="min-w-0 flex-1">
          {/* Header row */}
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <p className="font-bold text-gray-900 leading-tight" data-testid="x-preview-name">
              {profile.name}
            </p>
            <p className="text-xs text-gray-500" data-testid="x-preview-handle">
              {displayHandle}
            </p>
            <span className="text-xs text-gray-400">· Just now</span>
          </div>

          {/* Body */}
          <p
            className="mt-1 text-gray-800 whitespace-pre-wrap break-words"
            data-testid="x-preview-body"
          >
            {truncated || (
              <span className="italic text-gray-400">Your post content will appear here.</span>
            )}
          </p>

          {/* Image: 16:9 with rounded corners */}
          {firstImage && (
            <div className="mt-3 overflow-hidden rounded-2xl border" data-testid="x-preview-image">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={firstImage} alt="" className="w-full object-cover aspect-[16/9]" />
            </div>
          )}

          {/* Char counter */}
          <p
            className={cn(
              "mt-1.5 text-xs text-right",
              isOverLimit ? "text-red-500 font-semibold" : "text-gray-400",
            )}
            data-testid="x-preview-char-count"
          >
            {charCount}/{X_CHAR_LIMIT}
          </p>

          {/* 5-action row */}
          <div
            className="mt-1 flex items-center justify-between"
            data-testid="x-preview-actions"
          >
            <StatButton icon={MessageCircle} label="Reply" />
            <StatButton icon={Repeat2} label="Repost" />
            <StatButton icon={Heart} label="Like" />
            <StatButton icon={BarChart2} label="Views" />
            <StatButton icon={Bookmark} label="Bookmark" />
          </div>
        </div>
      </div>
    </div>
  );
}
