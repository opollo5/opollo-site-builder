"use client";

import * as React from "react";
import { ThumbsUp, MessageSquare, Share2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// FacebookPreviewCard — visual mock of a Facebook post card (Phase 3.2 / B3)
//
// Matches wireframe State 08 (Facebook section): 40px avatar, name+time header,
// body, 1.91:1 image, reactions bar, three-action row.
// ---------------------------------------------------------------------------

export interface FacebookPreviewProfile {
  name: string;
  avatarUrl?: string | null;
}

export interface FacebookPreviewCardProps {
  profile: FacebookPreviewProfile;
  content: string;
  media?: string[];
  className?: string;
}

const FB_BG = "#1877F2";

function AvatarFb({ profile }: { profile: FacebookPreviewProfile }) {
  const initials =
    profile.name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";

  return (
    <div className="h-10 w-10 shrink-0 rounded-full overflow-hidden" data-testid="fb-preview-avatar">
      {profile.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={profile.avatarUrl} alt={profile.name} className="h-full w-full object-cover" />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center text-sm font-semibold text-white"
          style={{ backgroundColor: FB_BG }}
        >
          {initials}
        </div>
      )}
    </div>
  );
}

function ActionButton({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex flex-1 items-center justify-center gap-1.5 rounded py-2 text-xs font-semibold text-gray-500 hover:bg-gray-100 transition-colors"
    >
      <Icon size={16} strokeWidth={1.75} />
      {label}
    </button>
  );
}

export function FacebookPreviewCard({
  profile,
  content,
  media = [],
  className,
}: FacebookPreviewCardProps) {
  const firstImage = media[0];

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-white text-sm shadow-sm",
        className,
      )}
      data-testid="fb-preview-card"
    >
      {/* Header */}
      <div className="flex items-center gap-3 p-4 pb-3">
        <AvatarFb profile={profile} />
        <div className="min-w-0 flex-1">
          <p
            className="font-semibold text-gray-900 leading-tight"
            data-testid="fb-preview-name"
          >
            {profile.name}
          </p>
          <p className="text-xs text-gray-500">Just now · 🌐</p>
        </div>
      </div>

      {/* Body */}
      <p
        className="px-4 pb-3 text-gray-800 leading-relaxed whitespace-pre-wrap break-words"
        data-testid="fb-preview-body"
      >
        {content || (
          <span className="italic text-gray-400">
            Your post content will appear here.
          </span>
        )}
      </p>

      {/* Image */}
      {firstImage && (
        <div data-testid="fb-preview-image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={firstImage} alt="" className="w-full object-cover aspect-[1.91/1]" />
        </div>
      )}

      {/* Reactions bar */}
      <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-gray-500">
        <span data-testid="fb-preview-reactions">👍 ❤️ 😮 · 234</span>
        <span>45 comments</span>
      </div>

      {/* Action row */}
      <div className="flex border-t px-1 py-1" data-testid="fb-preview-actions">
        <ActionButton icon={ThumbsUp} label="Like" />
        <ActionButton icon={MessageSquare} label="Comment" />
        <ActionButton icon={Share2} label="Share" />
      </div>
    </div>
  );
}
