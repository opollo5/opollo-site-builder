"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { Connection, Platform } from "@/lib/social/types";
import { LinkedInPreviewCard } from "@/components/social/preview/LinkedInPreviewCard";
import { FacebookPreviewCard } from "@/components/social/preview/FacebookPreviewCard";
import { InstagramPreviewCard } from "@/components/social/preview/InstagramPreviewCard";
import { XPreviewCard } from "@/components/social/preview/XPreviewCard";
import { GoogleBusinessPreviewCard } from "@/components/social/preview/GoogleBusinessPreviewCard";

// ---------------------------------------------------------------------------
// PreviewCard — renders post content in the visual style of the target platform.
// Used in the composer right pane and the post analytics modal (PR H).
//
// LinkedIn + Facebook: Phase 3.2 / B3
// Instagram, X, GBP: Phase 3.3 / B3
// Pinterest, TikTok: GenericPreview (no dedicated card yet)
// ---------------------------------------------------------------------------

export interface PreviewCardProps {
  platform: Platform;
  content: string;
  mediaUrls: string[];
  connection: Connection;
  className?: string;
}

const PLATFORM_NAME: Record<Platform, string> = {
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X (Twitter)",
  google_business_profile: "Google Business",
  pinterest: "Pinterest",
  tiktok: "TikTok",
};

const PLATFORM_BG: Record<Platform, string> = {
  linkedin: "#0A66C2",
  facebook: "#1877F2",
  instagram: "#DD2A7B",
  x: "#000000",
  google_business_profile: "#4584ED",
  pinterest: "#E60023",
  tiktok: "#010101",
};

function AvatarFallback({ name, bg }: { name: string; bg: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
      style={{ backgroundColor: bg }}
      aria-hidden
    >
      {initials || "?"}
    </div>
  );
}

function GenericPreview({ platform, content, mediaUrls, connection }: PreviewCardProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white text-sm shadow-sm">
      <div className="flex items-start gap-3 p-4">
        <AvatarFallback name={connection.account_name} bg={PLATFORM_BG[platform]} />
        <div>
          <p className="font-semibold text-gray-900">{connection.account_name}</p>
          <p className="text-xs text-gray-500">{PLATFORM_NAME[platform]}</p>
        </div>
      </div>
      <p className="px-4 pb-4 text-gray-800 whitespace-pre-wrap break-words">
        {content || <span className="italic text-gray-400">Your post content will appear here.</span>}
      </p>
      {mediaUrls[0] && (
        <div className="border-t">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mediaUrls[0]} alt="" className="w-full object-cover aspect-[1.91/1]" />
        </div>
      )}
    </div>
  );
}

export function PreviewCard({ platform, content, mediaUrls, connection, className }: PreviewCardProps) {
  const profile = { name: connection.account_name, avatarUrl: connection.account_avatar_url };

  return (
    <div className={cn("space-y-2", className)} data-testid="preview-card">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: PLATFORM_BG[platform] }}
          aria-hidden
        />
        {PLATFORM_NAME[platform]}
      </p>
      {platform === "linkedin" && (
        <LinkedInPreviewCard profile={profile} content={content} media={mediaUrls} />
      )}
      {platform === "facebook" && (
        <FacebookPreviewCard profile={profile} content={content} media={mediaUrls} />
      )}
      {platform === "x" && (
        <XPreviewCard profile={profile} content={content} media={mediaUrls} />
      )}
      {platform === "instagram" && (
        <InstagramPreviewCard profile={profile} content={content} media={mediaUrls} />
      )}
      {platform === "google_business_profile" && (
        <GoogleBusinessPreviewCard profile={profile} content={content} media={mediaUrls} />
      )}
      {(platform === "pinterest" || platform === "tiktok") && (
        <GenericPreview platform={platform} content={content} mediaUrls={mediaUrls} connection={connection} />
      )}
    </div>
  );
}
