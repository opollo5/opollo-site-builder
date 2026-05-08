"use client";

import { useState } from "react";

import { NavIcon } from "@/components/ui/nav-icon";
import type { DraftData } from "@/lib/platform/social/drafts";
import type { SocialConnection } from "@/lib/platform/social/connections/types";
import type { SocialPlatform } from "@/lib/platform/social/variants/types";
import { SUPPORTED_PLATFORMS } from "@/lib/platform/social/variants/types";
import type { ComposerMode } from "./scheduling-tabs";
import { LivePreviewCard } from "./live-preview-card";
import { MiniCalendarPreview } from "./mini-calendar-preview";

// ---------------------------------------------------------------------------
// Spec 22 PR 3 — ComposerPreview.
//
// Right-pane 40% of PostComposerModal. Two tabs:
//   "Post preview" — LivePreviewCard per selected platform, stacked.
//   "Calendar"     — MiniCalendarPreview highlighting the schedule date.
//
// Updates are driven by props from the modal (no internal fetch).
// ---------------------------------------------------------------------------

type PreviewTab = "post" | "calendar";

interface ComposerPreviewProps {
  draftData: DraftData | null;
  selectedPlatforms: SocialPlatform[];
  connections: SocialConnection[];
  mode: ComposerMode;
  scheduleDate: string; // YYYY-MM-DD
  scheduleTime: string; // HH:MM
}

export function ComposerPreview({
  draftData,
  selectedPlatforms,
  connections,
  mode,
  scheduleDate,
}: ComposerPreviewProps) {
  const [tab, setTab] = useState<PreviewTab>("post");

  const text = draftData?.master_text ?? "";
  const linkUrl = draftData?.link_url ?? null;

  // Map platform → display name from the matching connection.
  function displayNameFor(platform: SocialPlatform): string | undefined {
    const conn = connections.find((c) => c.platform === platform);
    return conn?.display_name ?? undefined;
  }

  // Order previews in the canonical SUPPORTED_PLATFORMS order.
  const orderedPlatforms = SUPPORTED_PLATFORMS.filter((p) =>
    selectedPlatforms.includes(p),
  );

  const isEmpty = orderedPlatforms.length === 0 || !text.trim();

  const highlightDate = mode === "schedule" ? scheduleDate : undefined;

  return (
    <div className="flex flex-col p-6 gap-0">
      {/* Tab bar */}
      <div role="tablist" className="mb-4 flex gap-1 border-b border-white/10 pb-0">
        {(["post", "calendar"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={[
              "pb-3 pr-4 text-sm transition-colors",
              tab === t
                ? "border-b-2 border-pk font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {t === "post" ? "Post preview" : "Calendar"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "post" ? (
        isEmpty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <NavIcon name="picture" size={32} className="opacity-30" />
            <p>Select at least one profile and start typing to see preview</p>
          </div>
        ) : (
          <div className="space-y-4">
            {orderedPlatforms.map((platform) => (
              <LivePreviewCard
                key={platform}
                platform={platform}
                text={text}
                linkUrl={linkUrl}
                displayName={displayNameFor(platform)}
              />
            ))}
          </div>
        )
      ) : (
        <MiniCalendarPreview highlightDate={highlightDate} />
      )}
    </div>
  );
}
