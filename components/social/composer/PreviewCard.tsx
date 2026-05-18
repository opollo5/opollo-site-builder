"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { Connection, Platform } from "@/lib/social/types";

// ---------------------------------------------------------------------------
// PreviewCard — renders post content in the visual style of the target platform.
// Used in the composer right pane and the post analytics modal (PR H).
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

function LinkedInPreview({ content, mediaUrls, connection }: Omit<PreviewCardProps, "platform" | "className">) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white text-sm shadow-sm">
      <div className="flex items-start gap-3 p-4">
        <AvatarFallback name={connection.account_name} bg={PLATFORM_BG.linkedin} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900 leading-tight">{connection.account_name}</p>
          <p className="text-xs text-gray-500">Just now · 🌐</p>
        </div>
      </div>
      <p className="px-4 pb-3 text-gray-800 leading-relaxed whitespace-pre-wrap break-words">
        {content || <span className="italic text-gray-400">Your post content will appear here.</span>}
      </p>
      {mediaUrls[0] && (
        <div className="border-t">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mediaUrls[0]} alt="" className="w-full object-cover aspect-[1.91/1]" />
        </div>
      )}
      <div className="flex items-center gap-4 border-t px-4 py-2 text-xs text-gray-500">
        <span>👍 Like</span>
        <span>💬 Comment</span>
        <span>↗ Share</span>
        <span>✉ Send</span>
      </div>
    </div>
  );
}

function FacebookPreview({ content, mediaUrls, connection }: Omit<PreviewCardProps, "platform" | "className">) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white text-sm shadow-sm">
      <div className="flex items-start gap-3 p-4">
        <AvatarFallback name={connection.account_name} bg={PLATFORM_BG.facebook} />
        <div>
          <p className="font-semibold text-gray-900">{connection.account_name}</p>
          <p className="text-xs text-gray-500">Just now · 🌐</p>
        </div>
      </div>
      <p className="px-4 pb-3 text-gray-800 whitespace-pre-wrap break-words">
        {content || <span className="italic text-gray-400">Your post content will appear here.</span>}
      </p>
      {mediaUrls[0] && (
        <div className="border-t">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mediaUrls[0]} alt="" className="w-full object-cover" />
        </div>
      )}
      <div className="flex items-center gap-4 border-t px-4 py-2 text-xs text-gray-500">
        <span>👍 Like</span>
        <span>💬 Comment</span>
        <span>↗ Share</span>
      </div>
    </div>
  );
}

function XPreview({ content, mediaUrls, connection }: Omit<PreviewCardProps, "platform" | "className">) {
  const truncated = content.length > 280 ? content.slice(0, 280) + "…" : content;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white text-sm shadow-sm">
      <div className="flex gap-3 p-4">
        <AvatarFallback name={connection.account_name} bg={PLATFORM_BG.x} />
        <div className="min-w-0 flex-1">
          <p className="font-bold text-gray-900">{connection.account_name}</p>
          <p className="mt-1 text-gray-800 whitespace-pre-wrap break-words">
            {truncated || <span className="italic text-gray-400">Your post content will appear here.</span>}
          </p>
          {mediaUrls[0] && (
            <div className="mt-3 overflow-hidden rounded-xl border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mediaUrls[0]} alt="" className="w-full object-cover aspect-[16/9]" />
            </div>
          )}
          <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
            <span>💬</span>
            <span>🔁</span>
            <span>❤️</span>
            <span>📤</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function InstagramPreview({ content, mediaUrls, connection }: Omit<PreviewCardProps, "platform" | "className">) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white text-sm shadow-sm">
      <div className="flex items-center gap-2 p-3 border-b">
        <AvatarFallback name={connection.account_name} bg={PLATFORM_BG.instagram} />
        <p className="font-semibold text-gray-900">{connection.account_name}</p>
      </div>
      {mediaUrls[0] ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mediaUrls[0]} alt="" className="w-full object-cover aspect-square" />
      ) : (
        <div className="aspect-square bg-muted flex items-center justify-center text-muted-foreground text-xs">No image</div>
      )}
      <div className="p-3">
        <p className="text-gray-800 whitespace-pre-wrap break-words">
          {content || <span className="italic text-gray-400">Caption will appear here.</span>}
        </p>
      </div>
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
          <img src={mediaUrls[0]} alt="" className="w-full object-cover" />
        </div>
      )}
    </div>
  );
}

export function PreviewCard({ platform, content, mediaUrls, connection, className }: PreviewCardProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: PLATFORM_BG[platform] }}
          aria-hidden
        />
        {PLATFORM_NAME[platform]}
      </p>
      {platform === "linkedin" && (
        <LinkedInPreview content={content} mediaUrls={mediaUrls} connection={connection} />
      )}
      {platform === "facebook" && (
        <FacebookPreview content={content} mediaUrls={mediaUrls} connection={connection} />
      )}
      {platform === "x" && (
        <XPreview content={content} mediaUrls={mediaUrls} connection={connection} />
      )}
      {platform === "instagram" && (
        <InstagramPreview content={content} mediaUrls={mediaUrls} connection={connection} />
      )}
      {(platform === "google_business_profile" || platform === "pinterest" || platform === "tiktok") && (
        <GenericPreview platform={platform} content={content} mediaUrls={mediaUrls} connection={connection} />
      )}
    </div>
  );
}
