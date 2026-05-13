"use client";

import { NavIcon } from "@/components/ui/nav-icon";
import type { SocialPlatform } from "@/lib/platform/social/variants/types";
import { PLATFORM_LABEL } from "@/lib/platform/social/variants/types";

// ---------------------------------------------------------------------------
// Spec 22 PR 3 — LivePreviewCard.
//
// Renders a per-platform mockup of how the post will appear. V1 shows the
// same master_text on all platforms (no per-platform copy variants per D12
// exclusions). The card is visual-only — tapping "Like" does nothing.
// ---------------------------------------------------------------------------

const CHAR_LIMITS: Partial<Record<SocialPlatform, number>> = {
  x: 280,
  linkedin_personal: 3000,
  linkedin_company: 3000,
  facebook_page: 63206,
  gbp: 1500,
};

// Tailwind bg classes for the platform accent stripe.
const PLATFORM_STRIPE: Record<SocialPlatform, string> = {
  linkedin_personal: "bg-[#0077B5]",
  linkedin_company: "bg-[#0077B5]",
  facebook_page: "bg-[#1877F2]",
  instagram_business: "bg-[#e1306c]",
  x: "bg-black",
  gbp: "bg-[#4285F4]",
};

interface LivePreviewCardProps {
  platform: SocialPlatform;
  text: string;
  linkUrl?: string | null;
  displayName?: string;
}

export function LivePreviewCard({
  platform,
  text,
  linkUrl,
  displayName,
}: LivePreviewCardProps) {
  const charLimit = CHAR_LIMITS[platform];
  const isOverLimit = charLimit !== undefined && text.length > charLimit;
  const label = PLATFORM_LABEL[platform];
  const name = displayName ?? label;

  const previewText = text.length > 600 ? text.slice(0, 600) + "…" : text;

  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-card text-sm">
      {/* Platform label bar */}
      <div className={`flex items-center gap-2 px-3 py-1.5 ${PLATFORM_STRIPE[platform]}/20 border-b border-white/10`}>
        <span className="text-xs font-medium text-foreground">{label}</span>
        {charLimit && (
          <span className={`ml-auto text-xs ${isOverLimit ? "text-destructive" : "text-muted-foreground/50"}`}>
            {text.length}/{charLimit}
          </span>
        )}
      </div>

      {/* Post body */}
      <div className="space-y-2 p-3">
        {/* Author row */}
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/10">
            <NavIcon name="user" size={14} className="text-muted-foreground" />
          </div>
          <div>
            <p className="text-xs font-medium text-foreground">{name}</p>
            <p className="text-xs text-muted-foreground/60">Just now</p>
          </div>
        </div>

        {/* Post text */}
        {previewText ? (
          <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
            {previewText}
          </p>
        ) : (
          <p className="text-xs italic text-muted-foreground/40">
            Start typing to see preview…
          </p>
        )}

        {/* Link strip */}
        {linkUrl && (
          <div className="truncate rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-muted-foreground">
            {linkUrl}
          </div>
        )}

        {/* Engagement row */}
        <div className="flex gap-4 border-t border-white/5 pt-2 text-xs text-muted-foreground/30">
          {platform === "x" ? (
            <>
              <span>Reply</span>
              <span>Repost</span>
              <span>Like</span>
              <span>Views</span>
            </>
          ) : platform === "gbp" ? (
            <span className="rounded border border-white/10 px-2 py-0.5 text-muted-foreground/50">
              Learn more
            </span>
          ) : (
            <>
              <span>Like</span>
              <span>Comment</span>
              <span>Share</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
