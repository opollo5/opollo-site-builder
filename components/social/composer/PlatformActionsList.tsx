"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { Platform } from "@/lib/social/types";

// ---------------------------------------------------------------------------
// PlatformActionsList — per-platform link / button / poll actions.
// Shown when a platform chip is active in CustomizeForRow.
// Clicking an action opens an inline input beneath the action row.
// ---------------------------------------------------------------------------

export interface PlatformActionsListProps {
  /** Platforms whose actions to display (typically just the active platform). */
  platforms: Platform[];
  /** Per-platform link values stored in draft.platform_variants[platform].link */
  links: Partial<Record<Platform, string>>;
  /** Per-platform CTA values stored in draft.platform_variants[platform].cta */
  ctas: Partial<Record<Platform, string>>;
  onLinkChange: (platform: Platform, value: string) => void;
  onCtaChange: (platform: Platform, value: string) => void;
  className?: string;
}

const PLATFORM_LABEL: Record<Platform, string> = {
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X",
  google_business_profile: "Google Business Profile",
  pinterest: "Pinterest",
  tiktok: "TikTok",
};

// Which actions each platform supports
const PLATFORM_SUPPORTS_LINK: Record<Platform, boolean> = {
  linkedin: true,
  facebook: true,
  instagram: false, // links in bio only
  x: false,
  google_business_profile: false,
  pinterest: true,
  tiktok: false,
};

const PLATFORM_SUPPORTS_CTA: Record<Platform, boolean> = {
  linkedin: false,
  facebook: false,
  instagram: false,
  x: false,
  google_business_profile: true,
  pinterest: false,
  tiktok: false,
};

function PlatformActionRow({
  platform,
  link,
  cta,
  onLinkChange,
  onCtaChange,
}: {
  platform: Platform;
  link?: string;
  cta?: string;
  onLinkChange: (v: string) => void;
  onCtaChange: (v: string) => void;
}) {
  const supportsLink = PLATFORM_SUPPORTS_LINK[platform];
  const supportsCta = PLATFORM_SUPPORTS_CTA[platform];

  const [linkOpen, setLinkOpen] = React.useState(!!link);
  const [ctaOpen, setCtaOpen] = React.useState(!!cta);

  if (!supportsLink && !supportsCta) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="font-medium">{PLATFORM_LABEL[platform]}</span>
        {supportsLink && (
          <button
            type="button"
            onClick={() => setLinkOpen((v) => !v)}
            className="text-primary hover:underline text-xs"
          >
            {linkOpen ? "− Remove link" : "+ Add link"}
          </button>
        )}
        {supportsCta && (
          <button
            type="button"
            onClick={() => setCtaOpen((v) => !v)}
            className="text-primary hover:underline text-xs"
          >
            {ctaOpen ? "− Remove button" : "+ Add button"}
          </button>
        )}
      </div>

      {linkOpen && supportsLink && (
        <input
          type="url"
          value={link ?? ""}
          onChange={(e) => onLinkChange(e.target.value)}
          placeholder="https://example.com"
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label={`Link for ${PLATFORM_LABEL[platform]}`}
        />
      )}

      {ctaOpen && supportsCta && (
        <select
          value={cta ?? ""}
          onChange={(e) => onCtaChange(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label={`CTA button for ${PLATFORM_LABEL[platform]}`}
        >
          <option value="">Select CTA button…</option>
          <option value="Book">Book</option>
          <option value="Order online">Order online</option>
          <option value="Learn more">Learn more</option>
          <option value="Sign up">Sign up</option>
          <option value="Get offer">Get offer</option>
          <option value="Call now">Call now</option>
        </select>
      )}
    </div>
  );
}

export function PlatformActionsList({
  platforms,
  links,
  ctas,
  onLinkChange,
  onCtaChange,
  className,
}: PlatformActionsListProps) {
  const actionable = platforms.filter(
    (p) => PLATFORM_SUPPORTS_LINK[p] || PLATFORM_SUPPORTS_CTA[p],
  );
  if (actionable.length === 0) return null;

  return (
    <div className={cn("space-y-3", className)}>
      {actionable.map((platform) => (
        <PlatformActionRow
          key={platform}
          platform={platform}
          link={links[platform]}
          cta={ctas[platform]}
          onLinkChange={(v) => onLinkChange(platform, v)}
          onCtaChange={(v) => onCtaChange(platform, v)}
        />
      ))}
    </div>
  );
}
