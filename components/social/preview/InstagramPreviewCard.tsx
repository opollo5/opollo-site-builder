"use client";

import * as React from "react";
import { Heart, MessageCircle, Send, Bookmark, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// InstagramPreviewCard — visual mock of an Instagram feed post (Phase 3.3 / B3)
//
// Matches wireframe State 09 (Instagram section): 32px avatar with gradient ring,
// square 1:1 image (required — shows warning when absent), heart/message/send/
// bookmark action row, likes count + username + caption inline.
// ---------------------------------------------------------------------------

export interface InstagramPreviewProfile {
  name: string;
  avatarUrl?: string | null;
  handle?: string;
}

export interface InstagramPreviewCardProps {
  profile: InstagramPreviewProfile;
  content: string;
  media?: string[];
  className?: string;
}

const IG_BG = "#DD2A7B";
const IG_GRADIENT = "linear-gradient(135deg, #F58529 0%, #DD2A7B 40%, #8134AF 70%, #515BD4 100%)";

function AvatarIg({ profile }: { profile: InstagramPreviewProfile }) {
  const initials =
    profile.name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";

  return (
    // Gradient ring: Instagram brand gradient wrapped around the avatar
    <div
      className="h-8 w-8 shrink-0 rounded-full p-0.5"
      style={{ background: IG_GRADIENT }}
      data-testid="ig-preview-avatar"
    >
      <div className="h-full w-full rounded-full overflow-hidden bg-white p-px">
        {profile.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.avatarUrl}
            alt={profile.name}
            className="h-full w-full rounded-full object-cover"
          />
        ) : (
          <div
            className="flex h-full w-full rounded-full items-center justify-center text-xs font-semibold text-white"
            style={{ backgroundColor: IG_BG }}
          >
            {initials}
          </div>
        )}
      </div>
    </div>
  );
}

export function InstagramPreviewCard({
  profile,
  content,
  media = [],
  className,
}: InstagramPreviewCardProps) {
  const firstImage = media[0];
  const handle = profile.handle ?? profile.name.toLowerCase().replace(/\s+/g, "_");

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-white text-sm shadow-sm",
        className,
      )}
      data-testid="ig-preview-card"
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 p-3">
        <AvatarIg profile={profile} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900 text-xs leading-tight" data-testid="ig-preview-name">
            {handle}
          </p>
        </div>
        <span className="text-gray-400 text-xs">•••</span>
      </div>

      {/* Image — 1:1 required */}
      {firstImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={firstImage}
          alt=""
          className="w-full object-cover aspect-square"
          data-testid="ig-preview-image"
        />
      ) : (
        <div
          className="aspect-square bg-muted flex flex-col items-center justify-center gap-2 text-muted-foreground"
          data-testid="ig-preview-no-image"
        >
          <AlertTriangle size={20} className="text-amber-500" strokeWidth={1.75} />
          <p className="text-xs text-center px-4">
            Instagram posts perform best with an image. Add media above.
          </p>
        </div>
      )}

      {/* Action row: Heart, Message, Send, Bookmark */}
      <div className="flex items-center px-3 pt-2.5 pb-1" data-testid="ig-preview-actions">
        <div className="flex items-center gap-3 flex-1">
          <button type="button" aria-label="Like" className="text-gray-700 hover:text-gray-900">
            <Heart size={22} strokeWidth={1.75} />
          </button>
          <button type="button" aria-label="Comment" className="text-gray-700 hover:text-gray-900">
            <MessageCircle size={22} strokeWidth={1.75} />
          </button>
          <button type="button" aria-label="Share" className="text-gray-700 hover:text-gray-900">
            <Send size={22} strokeWidth={1.75} />
          </button>
        </div>
        <button type="button" aria-label="Save" className="text-gray-700 hover:text-gray-900">
          <Bookmark size={22} strokeWidth={1.75} />
        </button>
      </div>

      {/* Likes + caption */}
      <div className="px-3 pb-3">
        <p className="text-xs font-semibold text-gray-900 mb-0.5" data-testid="ig-preview-likes">
          234 likes
        </p>
        <p className="text-xs text-gray-800 break-words" data-testid="ig-preview-body">
          <span className="font-semibold mr-1">{handle}</span>
          {content || (
            <span className="italic text-gray-400">Caption will appear here.</span>
          )}
        </p>
      </div>
    </div>
  );
}
