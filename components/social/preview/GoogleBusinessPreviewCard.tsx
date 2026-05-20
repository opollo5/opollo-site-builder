"use client";

import * as React from "react";
import { ExternalLink, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// GoogleBusinessPreviewCard — visual mock of a GBP post (Phase 3.3 / B3)
//
// Matches wireframe State 08 (GBP section): 40px business logo (letter fallback),
// business name + category, body, 1.91:1 image, CTA button.
// ---------------------------------------------------------------------------

export interface GoogleBusinessPreviewProfile {
  name: string;
  avatarUrl?: string | null;
  category?: string;
  address?: string;
}

export interface GoogleBusinessPreviewCardProps {
  profile: GoogleBusinessPreviewProfile;
  content: string;
  media?: string[];
  ctaLabel?: string;
  className?: string;
}

const GBP_BG = "#4584ED";

function AvatarGbp({ profile }: { profile: GoogleBusinessPreviewProfile }) {
  const initial = profile.name.trimStart()[0]?.toUpperCase() ?? "G";

  return (
    <div className="h-10 w-10 shrink-0 rounded-full overflow-hidden" data-testid="gbp-preview-avatar">
      {profile.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={profile.avatarUrl} alt={profile.name} className="h-full w-full object-cover" />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center text-base font-bold text-white"
          style={{ backgroundColor: GBP_BG }}
        >
          {initial}
        </div>
      )}
    </div>
  );
}

export function GoogleBusinessPreviewCard({
  profile,
  content,
  media = [],
  ctaLabel = "Learn more",
  className,
}: GoogleBusinessPreviewCardProps) {
  const firstImage = media[0];

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-white text-sm shadow-sm",
        className,
      )}
      data-testid="gbp-preview-card"
    >
      {/* Header */}
      <div className="flex items-center gap-3 p-4 pb-3">
        <AvatarGbp profile={profile} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900 leading-tight truncate" data-testid="gbp-preview-name">
            {profile.name}
          </p>
          {(profile.category ?? profile.address) && (
            <p className="text-xs text-gray-500 truncate">
              {[profile.category, profile.address].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      </div>

      {/* Body */}
      <p
        className="px-4 pb-3 text-xs text-gray-800 leading-relaxed whitespace-pre-wrap break-words"
        data-testid="gbp-preview-body"
      >
        {content || (
          <span className="italic text-gray-400">Your post content will appear here.</span>
        )}
      </p>

      {/* Image */}
      {firstImage && (
        <div data-testid="gbp-preview-image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={firstImage} alt="" className="w-full object-cover aspect-[1.91/1]" />
        </div>
      )}

      {/* CTA button */}
      <div className="px-4 py-3">
        <button
          type="button"
          className="flex items-center gap-1.5 rounded border border-border px-4 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 transition-colors"
          data-testid="gbp-preview-cta"
        >
          <ExternalLink size={12} strokeWidth={2} />
          {ctaLabel}
        </button>
      </div>
    </div>
  );
}
