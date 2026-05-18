"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ContentEditor } from "@/components/social/composer/ContentEditor";
import { CustomizeForRow } from "@/components/social/composer/CustomizeForRow";
import { PlatformActionsList } from "@/components/social/composer/PlatformActionsList";
import { PLATFORM_CHAR_LIMITS } from "@/lib/social/types";
import type { Connection, Draft, Platform, SchedulingMode } from "@/lib/social/types";

// ---------------------------------------------------------------------------
// ComposerEditor — orchestrates the left pane of ComposerOverlay.
//
// Renders: content editor, customize-for row, platform actions list.
// SchedulingCard + ApprovalToggle + submit row are wired in PR E.
// Slot prop `schedulingSlot` accepts those components once available.
// ---------------------------------------------------------------------------

export interface ComposerEditorProps {
  draft: Draft;
  onChange: (d: Draft) => void;
  onSubmit: (mode: SchedulingMode) => Promise<void>;
  companyId: string;
  /** Connections currently selected — drives CustomizeForRow platform list. */
  selectedConnections: Connection[];
  /** Slot for SchedulingCard + submit row (PR E). */
  schedulingSlot?: React.ReactNode;
  className?: string;
}

export function ComposerEditor({
  draft,
  onChange,
  onSubmit: _onSubmit,
  companyId,
  selectedConnections,
  schedulingSlot,
  className,
}: ComposerEditorProps) {
  const [activePlatform, setActivePlatform] = React.useState<Platform | null>(null);

  // Unique platforms from the selected connections
  const platforms: Platform[] = Array.from(
    new Set(selectedConnections.map((c) => c.platform)),
  );

  // If activePlatform is no longer in the list, reset
  React.useEffect(() => {
    if (activePlatform && !platforms.includes(activePlatform)) {
      setActivePlatform(null);
    }
  }, [platforms, activePlatform]);

  // The content shown depends on whether a platform variant is active
  const variantContent = activePlatform
    ? (draft.platform_variants[activePlatform]?.content ?? "")
    : "";
  const displayContent = activePlatform ? variantContent : draft.content;

  const charLimit = activePlatform
    ? PLATFORM_CHAR_LIMITS[activePlatform]
    : Math.min(...(platforms.length > 0 ? platforms.map((p) => PLATFORM_CHAR_LIMITS[p]) : [3000]));

  function handleContentChange(text: string) {
    if (activePlatform) {
      onChange({
        ...draft,
        platform_variants: {
          ...draft.platform_variants,
          [activePlatform]: {
            ...draft.platform_variants[activePlatform],
            content: text,
          },
        },
      });
    } else {
      onChange({ ...draft, content: text });
    }
  }

  function handleLinkChange(platform: Platform, value: string) {
    onChange({
      ...draft,
      platform_variants: {
        ...draft.platform_variants,
        [platform]: { ...draft.platform_variants[platform], link: value },
      },
    });
  }

  function handleCtaChange(platform: Platform, value: string) {
    onChange({
      ...draft,
      platform_variants: {
        ...draft.platform_variants,
        [platform]: { ...draft.platform_variants[platform], cta: value },
      },
    });
  }

  const links = Object.fromEntries(
    platforms.map((p) => [p, draft.platform_variants[p]?.link ?? ""]),
  ) as Partial<Record<Platform, string>>;

  const ctas = Object.fromEntries(
    platforms.map((p) => [p, draft.platform_variants[p]?.cta ?? ""]),
  ) as Partial<Record<Platform, string>>;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <ContentEditor
        value={displayContent}
        onChange={handleContentChange}
        mediaUrls={draft.media_urls}
        onMediaChange={(urls) => onChange({ ...draft, media_urls: urls })}
        maxLength={charLimit}
        companyId={companyId}
      />

      {platforms.length >= 2 && (
        <CustomizeForRow
          platforms={platforms}
          activePlatform={activePlatform}
          onChange={setActivePlatform}
        />
      )}

      {platforms.length > 0 && (
        <PlatformActionsList
          platforms={activePlatform ? [activePlatform] : platforms}
          links={links}
          ctas={ctas}
          onLinkChange={handleLinkChange}
          onCtaChange={handleCtaChange}
        />
      )}

      {/* SchedulingCard + ApprovalToggle + submit row (PR E) */}
      {schedulingSlot ?? (
        <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
          <button
            type="button"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            onClick={() => _onSubmit("draft")}
          >
            Save as draft
          </button>
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            onClick={() => _onSubmit("post_now")}
          >
            Post now
          </button>
        </div>
      )}
    </div>
  );
}
