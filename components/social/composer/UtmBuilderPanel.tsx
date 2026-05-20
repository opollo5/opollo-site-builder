"use client";

import * as React from "react";
import { X as CloseIcon, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Platform } from "@/lib/social/types";

// ---------------------------------------------------------------------------
// UtmBuilderPanel — structured UTM parameter builder (Phase 4.3 / B5)
//
// Features:
//  - Destination URL + campaign (required)
//  - Medium (default "social")
//  - Auto-detect source from platform (toggle, default on)
//  - Advanced section: content + term (collapsed)
//  - Live monospace preview with color-coded base / param key / value
//  - Persists last utm_campaign in localStorage
// ---------------------------------------------------------------------------

const STORAGE_KEY_CAMPAIGN = "composer_utm_last_campaign";

const PLATFORM_SOURCE_MAP: Record<Platform, string> = {
  linkedin: "linkedin",
  facebook: "facebook",
  instagram: "instagram",
  x: "twitter",
  google_business_profile: "google",
  pinterest: "pinterest",
  tiktok: "tiktok",
};

function deriveAutoSource(platforms: Platform[]): string {
  if (platforms.length === 0) return "";
  if (platforms.length === 1) return PLATFORM_SOURCE_MAP[platforms[0]] ?? platforms[0];
  // Multiple platforms: join for display
  return platforms.map((p) => PLATFORM_SOURCE_MAP[p] ?? p).join(", ");
}

interface UtmBuilderPanelProps {
  onInsert: (text: string) => void;
  onClose: () => void;
  platforms?: Platform[];
}

export function UtmBuilderPanel({ onInsert, onClose, platforms = [] }: UtmBuilderPanelProps) {
  const [url, setUrl] = React.useState("");
  const [campaign, setCampaign] = React.useState(() => {
    try { return localStorage.getItem(STORAGE_KEY_CAMPAIGN) ?? ""; } catch { return ""; }
  });
  const [medium, setMedium] = React.useState("social");
  const [autoSource, setAutoSource] = React.useState(true);
  const [manualSource, setManualSource] = React.useState("");
  const [content, setContent] = React.useState("");
  const [term, setTerm] = React.useState("");
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [urlError, setUrlError] = React.useState<string | null>(null);

  const autoSourceValue = deriveAutoSource(platforms);
  const source = (autoSource && platforms.length > 0) ? autoSourceValue : manualSource;

  function buildTrackedUrl(): string | null {
    if (!url.trim()) return null;
    try {
      const u = new URL(url.trim());
      if (medium) u.searchParams.set("utm_medium", medium);
      if (campaign) u.searchParams.set("utm_campaign", campaign);
      if (source) u.searchParams.set("utm_source", source);
      if (content) u.searchParams.set("utm_content", content);
      if (term) u.searchParams.set("utm_term", term);
      return u.toString();
    } catch {
      return null;
    }
  }

  const trackedUrl = buildTrackedUrl();

  function handleInsert() {
    if (!trackedUrl) {
      setUrlError("Please enter a valid URL (include https://)");
      return;
    }
    try { localStorage.setItem(STORAGE_KEY_CAMPAIGN, campaign); } catch { /* ignore */ }
    onInsert(trackedUrl);
    onClose();
  }

  // Parse preview URL for color-coded display
  const previewSegments = React.useMemo<Array<{ text: string; type: "base" | "sep" | "key" | "eq" | "val" }>>(() => {
    if (!trackedUrl) return [];
    try {
      const u = new URL(trackedUrl);
      const base = `${u.protocol}//${u.host}${u.pathname}`;
      const params = [...u.searchParams.entries()];
      if (params.length === 0) return [{ text: base, type: "base" }];
      const segs: Array<{ text: string; type: "base" | "sep" | "key" | "eq" | "val" }> = [
        { text: base, type: "base" },
        { text: "?", type: "sep" },
      ];
      params.forEach(([k, v], i) => {
        if (i > 0) segs.push({ text: "&", type: "sep" });
        segs.push({ text: k, type: "key" });
        segs.push({ text: "=", type: "eq" });
        segs.push({ text: v, type: "val" });
      });
      return segs;
    } catch {
      return [{ text: trackedUrl, type: "base" }];
    }
  }, [trackedUrl]);

  return (
    <div className="w-80 space-y-3 rounded-xl border border-border bg-background p-4 shadow-md" data-testid="utm-builder-panel">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">UTM tags</p>
        <button type="button" onClick={onClose} aria-label="Close UTM panel" className="text-muted-foreground hover:text-foreground transition-colors">
          <CloseIcon size={14} strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      {/* Destination URL */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground" htmlFor="utm-url">
          Destination URL <span className="text-destructive">*</span>
        </label>
        <input
          id="utm-url"
          type="url"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setUrlError(null); }}
          placeholder="https://example.com/page"
          className={cn(
            "w-full rounded-md border bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1",
            urlError ? "border-destructive focus:ring-destructive" : "border-input focus:ring-ring",
          )}
          data-testid="utm-url-input"
          aria-required="true"
        />
        {urlError && <p className="text-xs text-destructive" role="alert">{urlError}</p>}
      </div>

      {/* Campaign */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground" htmlFor="utm-campaign">
          Campaign name <span className="text-destructive">*</span>
        </label>
        <input
          id="utm-campaign"
          type="text"
          value={campaign}
          onChange={(e) => setCampaign(e.target.value)}
          placeholder="spring-promo"
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          data-testid="utm-campaign-input"
        />
      </div>

      {/* Medium */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground" htmlFor="utm-medium">Medium</label>
        <input
          id="utm-medium"
          type="text"
          value={medium}
          onChange={(e) => setMedium(e.target.value)}
          placeholder="social"
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          data-testid="utm-medium-input"
        />
      </div>

      {/* Source */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground" htmlFor="utm-source">Source</label>
          {platforms.length > 0 && (
            <label className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground select-none">
              <input
                type="checkbox"
                checked={autoSource}
                onChange={(e) => setAutoSource(e.target.checked)}
                className="accent-emerald-500 h-3 w-3"
                data-testid="utm-auto-source-toggle"
                aria-label="Auto-detect source from platform"
              />
              Auto-detect
            </label>
          )}
        </div>
        <input
          id="utm-source"
          type="text"
          value={source}
          onChange={(e) => { if (!(autoSource && platforms.length > 0)) setManualSource(e.target.value); }}
          placeholder={platforms.length > 0 ? "platform" : "linkedin"}
          disabled={autoSource && platforms.length > 0}
          className={cn(
            "w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring",
            autoSource && platforms.length > 0 && "opacity-60 cursor-not-allowed",
          )}
          data-testid="utm-source-input"
        />
      </div>

      {/* Advanced toggle */}
      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="flex w-full items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors"
        data-testid="utm-advanced-toggle"
        aria-expanded={showAdvanced}
      >
        <span>Advanced</span>
        {showAdvanced
          ? <ChevronUp size={12} strokeWidth={1.75} aria-hidden />
          : <ChevronDown size={12} strokeWidth={1.75} aria-hidden />
        }
      </button>

      {showAdvanced && (
        <div className="space-y-3" data-testid="utm-advanced-section">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="utm-content">Content</label>
            <input
              id="utm-content"
              type="text"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="hero-cta"
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              data-testid="utm-content-input"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="utm-term">Term</label>
            <input
              id="utm-term"
              type="text"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="brand+awareness"
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              data-testid="utm-term-input"
            />
          </div>
        </div>
      )}

      {/* Live preview */}
      {previewSegments.length > 0 && (
        <div
          className="rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs leading-relaxed break-all"
          data-testid="utm-preview"
          aria-label="URL preview"
        >
          {previewSegments.map((seg, i) => (
            <span
              key={i}
              className={cn(
                seg.type === "base" && "text-foreground",
                seg.type === "sep" && "text-muted-foreground",
                seg.type === "key" && "text-blue-600",
                seg.type === "eq" && "text-muted-foreground",
                seg.type === "val" && "text-emerald-600",
              )}
            >
              {seg.text}
            </span>
          ))}
        </div>
      )}

      {/* Insert button */}
      <button
        type="button"
        onClick={handleInsert}
        disabled={!url.trim() || !campaign.trim()}
        className="w-full rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50 transition-colors"
        data-testid="utm-insert-button"
      >
        Insert URL with UTM tags
      </button>
    </div>
  );
}
