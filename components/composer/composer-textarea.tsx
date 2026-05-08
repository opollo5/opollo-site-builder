"use client";

import { useCallback, useRef, useState } from "react";

import type { SocialPlatform } from "@/lib/platform/social/variants/types";

// ---------------------------------------------------------------------------
// Spec 22 PR 2 — ComposerTextarea.
//
// Character counter uses the strictest limit among selected platforms.
// Link detection: on paste, if a bare URL is detected and no link_url is
// set, offers a one-click "Use as link" prompt. Clearing link_url removes
// the URL from master_text only when the user explicitly removes it.
// ---------------------------------------------------------------------------

const CHAR_LIMITS: Partial<Record<SocialPlatform, number>> = {
  x: 280,
  linkedin_personal: 3000,
  linkedin_company: 3000,
  facebook_page: 63206,
  gbp: 1500,
};

function effectiveLimit(platforms: SocialPlatform[]): number {
  if (platforms.length === 0) return 3000;
  return Math.min(...platforms.map((p) => CHAR_LIMITS[p] ?? 3000));
}

const URL_RE = /^https?:\/\/[^\s]{6,}$/;

interface ComposerTextareaProps {
  value: string;
  linkUrl: string | null | undefined;
  selectedPlatforms: SocialPlatform[];
  onChange: (text: string) => void;
  onLinkUrl: (url: string | null) => void;
  disabled?: boolean;
}

export function ComposerTextarea({
  value,
  linkUrl,
  selectedPlatforms,
  onChange,
  onLinkUrl,
  disabled,
}: ComposerTextareaProps) {
  const limit = effectiveLimit(selectedPlatforms);
  const remaining = limit - value.length;
  const isNearLimit = remaining <= 50 && remaining > 0;
  const isOverLimit = remaining < 0;

  const [detectedUrl, setDetectedUrl] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const text = e.target.value;
      onChange(text);
      // Auto-resize.
      const el = textareaRef.current;
      if (el) {
        el.style.height = "auto";
        el.style.height = `${Math.max(120, el.scrollHeight)}px`;
      }
      // Detect bare URL lines for the "use as link" prompt.
      const trimmed = text.trim();
      if (!linkUrl && URL_RE.test(trimmed)) {
        setDetectedUrl(trimmed);
      } else {
        setDetectedUrl(null);
      }
    },
    [onChange, linkUrl],
  );

  return (
    <div className="space-y-1">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        disabled={disabled}
        placeholder="Paste a link or type something…"
        rows={5}
        className={[
          "w-full resize-none overflow-hidden rounded-md border bg-white/[0.03] px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:opacity-50",
          isOverLimit
            ? "border-destructive focus:ring-destructive/50"
            : "border-white/10 focus:ring-white/20",
        ].join(" ")}
      />

      <div className="flex min-h-[20px] items-center justify-between gap-4">
        {/* Link URL prompt / indicator */}
        <div className="flex-1">
          {detectedUrl && !linkUrl && (
            <button
              type="button"
              onClick={() => {
                onLinkUrl(detectedUrl);
                setDetectedUrl(null);
              }}
              className="text-xs text-pk hover:underline"
            >
              Use &ldquo;{detectedUrl.length > 45 ? detectedUrl.slice(0, 45) + "…" : detectedUrl}&rdquo; as link preview
            </button>
          )}
          {linkUrl && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>Link:</span>
              <span className="max-w-[220px] truncate opacity-80">{linkUrl}</span>
              <button
                type="button"
                onClick={() => onLinkUrl(null)}
                aria-label="Remove link URL"
                className="rounded text-destructive/70 hover:text-destructive"
              >
                ×
              </button>
            </span>
          )}
        </div>

        {/* Character count */}
        <span
          className={[
            "shrink-0 text-xs tabular-nums",
            isOverLimit
              ? "font-medium text-destructive"
              : isNearLimit
                ? "text-amber-400"
                : "text-muted-foreground",
          ].join(" ")}
        >
          {isOverLimit ? `${Math.abs(remaining)} over` : remaining}
        </span>
      </div>
    </div>
  );
}
