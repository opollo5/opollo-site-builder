"use client";

import * as React from "react";
import { ThumbsUp, MessageSquare, Repeat2, SendHorizontal, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// LinkedInPreviewCard — visual mock of a LinkedIn post card (Phase 3.2 / B3)
//
// Matches wireframe State 02+03: 48px avatar, name+headline header,
// body with "…see more" at 210 chars, 1.91:1 image, reaction row + action row.
// ---------------------------------------------------------------------------

export interface LinkedInPreviewProfile {
  name: string;
  avatarUrl?: string | null;
  headline?: string;
}

export interface LinkedInPreviewCardProps {
  profile: LinkedInPreviewProfile;
  content: string;
  media?: string[];
  className?: string;
}

const LI_BG = "#0A66C2";
const PREVIEW_CHAR_LIMIT = 210;

function AvatarLi({ profile }: { profile: LinkedInPreviewProfile }) {
  const initials =
    profile.name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";

  return (
    <div className="relative h-12 w-12 shrink-0 rounded-full overflow-hidden" data-testid="li-preview-avatar">
      {profile.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={profile.avatarUrl} alt={profile.name} className="h-full w-full object-cover" />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center text-sm font-semibold text-white"
          style={{ backgroundColor: LI_BG }}
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
      className="flex flex-1 items-center justify-center gap-1.5 rounded py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-100 transition-colors"
    >
      <Icon size={16} strokeWidth={1.75} />
      {label}
    </button>
  );
}

export function LinkedInPreviewCard({
  profile,
  content,
  media = [],
  className,
}: LinkedInPreviewCardProps) {
  const [expanded, setExpanded] = React.useState(false);
  const isLong = content.length > PREVIEW_CHAR_LIMIT;
  const displayContent =
    isLong && !expanded ? content.slice(0, PREVIEW_CHAR_LIMIT) + "…" : content;
  const firstImage = media[0];

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-white text-sm shadow-sm",
        className,
      )}
      data-testid="li-preview-card"
    >
      {/* Header */}
      <div className="flex items-start gap-3 p-4 pb-3">
        <AvatarLi profile={profile} />
        <div className="min-w-0 flex-1">
          <p
            className="font-semibold text-gray-900 leading-tight truncate"
            data-testid="li-preview-name"
          >
            {profile.name}
          </p>
          {profile.headline && (
            <p
              className="text-xs text-gray-500 truncate leading-snug"
              data-testid="li-preview-headline"
            >
              {profile.headline}
            </p>
          )}
          <p className="text-xs text-gray-400 leading-snug">1st · Just now · 🌐</p>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 pb-3">
        <p
          className="text-gray-800 leading-relaxed whitespace-pre-wrap break-words"
          data-testid="li-preview-body"
        >
          {displayContent || (
            <span className="italic text-gray-400">
              Your post content will appear here.
            </span>
          )}
        </p>
        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded((p) => !p)}
            className="mt-0.5 text-xs font-semibold text-gray-500 hover:text-gray-800"
          >
            {expanded ? "…see less" : "…see more"}
          </button>
        )}
      </div>

      {/* Image */}
      {firstImage && (
        <div className="border-t" data-testid="li-preview-image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={firstImage} alt="" className="w-full object-cover aspect-[1.91/1]" />
        </div>
      )}

      {/* Reaction row */}
      <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-gray-500">
        <span data-testid="li-preview-reactions">👍 ❤️ 😂 · 234</span>
        <span>45 comments · 12 reposts</span>
      </div>

      {/* Action row */}
      <div className="flex border-t px-1 py-1" data-testid="li-preview-actions">
        <ActionButton icon={ThumbsUp} label="Like" />
        <ActionButton icon={MessageSquare} label="Comment" />
        <ActionButton icon={Repeat2} label="Repost" />
        <ActionButton icon={SendHorizontal} label="Send" />
      </div>
    </div>
  );
}
