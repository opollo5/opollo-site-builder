"use client";

import * as React from "react";
import useSWR from "swr";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { SocialPlatformIcon, type SocialPlatformIconKey } from "@/components/ui/SocialPlatformIcon";
import type { DraftResponse, Platform } from "@/lib/social/types";

// ---------------------------------------------------------------------------
// PostAnalyticsModal — COMPONENT_MAP.md §"Post analytics modal" (PR H)
//
// Two-column: left = post preview render, right = metrics + post info.
// Per-platform metric variation (LinkedIn, GBP, etc.)
// "Schedule again" → re-open composer pre-filled.
// "Open post" → opens published_url in new tab.
// "More" → dropdown with Delete, Duplicate, Copy link.
// ---------------------------------------------------------------------------

export interface PostAnalyticsModalProps {
  open: boolean;
  onClose: () => void;
  draftId: string;
  onScheduleAgain?: (draft: DraftResponse) => void;
  onDelete?: (id: string) => void;
}

interface AnalyticsData {
  impressions: number | null;
  engagement_rate: number | null;
  reactions: number | null;
  shares: number | null;
  comments: number | null;
  clicks: number | null;
  views: number | null;
  calls: number | null;
  directions: number | null;
  platform_specific: Record<string, unknown>;
  fetched_at: string;
  is_stale: boolean;
}

interface AnalyticsResponse {
  ok: boolean;
  data: AnalyticsData;
}

interface DraftApiResponse {
  ok: boolean;
  data: DraftResponse;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  return res.json() as Promise<T>;
}

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatPercent(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(1)}%`;
}

function formatPublishedAt(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

interface MetricRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

function MetricRow({ icon, label, value }: MetricRowProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-t border-border first:border-t-0">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="flex-1 text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground" data-testid="metric-value">{value}</span>
    </div>
  );
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

function StatCard({ icon, label, value }: StatCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-xl font-bold text-foreground" data-testid="stat-card-value">{value}</div>
    </div>
  );
}

function PlatformMetrics({ platform, data }: { platform: Platform; data: AnalyticsData }) {
  const eyeIcon = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>;
  const thumbIcon = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7" /></svg>;
  const shareIcon = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m17 1 4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="m7 23-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>;
  const commentIcon = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>;
  const clickIcon = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z" /><path d="m13 13 6 6" /></svg>;
  const phoneIcon = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.44 2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9a16 16 0 0 0 6.08 6.08l1.84-1.84a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>;
  const mapPinIcon = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>;

  if (platform === "google_business_profile") {
    return (
      <div className="rounded-lg border border-border bg-card overflow-hidden" data-testid="engagement-details">
        <div className="px-3 py-2 text-xs font-semibold text-muted-foreground bg-muted">Engagement details</div>
        <MetricRow icon={eyeIcon} label="Views" value={formatNumber(data.views)} />
        <MetricRow icon={phoneIcon} label="Calls" value={formatNumber(data.calls)} />
        <MetricRow icon={mapPinIcon} label="Direction requests" value={formatNumber(data.directions)} />
        <MetricRow icon={clickIcon} label="Clicks" value={formatNumber(data.clicks)} />
      </div>
    );
  }

  if (platform === "linkedin") {
    return (
      <div className="rounded-lg border border-border bg-card overflow-hidden" data-testid="engagement-details">
        <div className="px-3 py-2 text-xs font-semibold text-muted-foreground bg-muted">Engagement details</div>
        <MetricRow icon={thumbIcon} label="Reactions" value={formatNumber(data.reactions)} />
        <MetricRow icon={shareIcon} label="Shares" value={formatNumber(data.shares)} />
        <MetricRow icon={commentIcon} label="Comments" value={formatNumber(data.comments)} />
        <MetricRow icon={clickIcon} label="Clicks" value={formatNumber(data.clicks)} />
      </div>
    );
  }

  // Default / Facebook / Instagram
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden" data-testid="engagement-details">
      <div className="px-3 py-2 text-xs font-semibold text-muted-foreground bg-muted">Engagement details</div>
      <MetricRow icon={thumbIcon} label="Reactions" value={formatNumber(data.reactions)} />
      <MetricRow icon={commentIcon} label="Comments" value={formatNumber(data.comments)} />
      <MetricRow icon={shareIcon} label="Shares" value={formatNumber(data.shares)} />
      <MetricRow icon={clickIcon} label="Clicks" value={formatNumber(data.clicks)} />
    </div>
  );
}

export function PostAnalyticsModal({ open, onClose, draftId, onScheduleAgain, onDelete }: PostAnalyticsModalProps) {
  const [moreOpen, setMoreOpen] = React.useState(false);
  const moreRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    if (moreOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [moreOpen]);

  const { data: draftRes } = useSWR<DraftApiResponse>(
    open && draftId ? `/api/platform/social/drafts/${draftId}` : null,
    fetchJson,
    { revalidateOnFocus: false },
  );

  const { data: analyticsRes } = useSWR<AnalyticsResponse>(
    open && draftId ? `/api/platform/social/drafts/${draftId}/analytics` : null,
    fetchJson,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );

  const draft = draftRes?.data;
  const analytics = analyticsRes?.data;
  const primaryProfile = draft?.target_profiles[0];
  const platform: Platform = primaryProfile?.platform ?? "linkedin";
  const iconKey = platform.toUpperCase().replace("GOOGLE_BUSINESS_PROFILE", "GOOGLE_BUSINESS") as SocialPlatformIconKey;

  async function handleDelete() {
    if (!draft) return;
    try {
      await fetch(`/api/platform/social/drafts/${draft.id}`, { method: "DELETE" });
      onDelete?.(draft.id);
      onClose();
    } catch {
      // ignore
    }
  }

  async function handleDuplicate() {
    if (!draft) return;
    try {
      await fetch("/api/platform/social/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: draft.content,
          media_urls: draft.media_urls,
          target_profile_ids: draft.target_profiles.map((p) => p.profile_id),
          mode: "draft",
        }),
      });
    } catch {
      // ignore
    }
    onClose();
  }

  function handleCopyLink() {
    if (draft?.published_url) {
      void navigator.clipboard.writeText(draft.published_url);
    }
  }

  const calendarIcon = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>;
  const linkIcon = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl" data-testid="post-analytics-modal">
        <DialogHeader>
          <DialogTitle className="text-base">Post performance</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-6 overflow-auto max-h-[70vh]" data-testid="analytics-grid">
          {/* Left: post preview */}
          <div className="flex flex-col gap-3">
            {primaryProfile && (
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <SocialPlatformIcon platform={iconKey} size={14} />
                <span>{platform.toUpperCase().replace("_", " ")}</span>
              </div>
            )}
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-sm text-foreground whitespace-pre-wrap">
                {draft?.content ?? "Loading…"}
              </p>
              {draft?.media_urls?.[0] && (
                <div className="mt-3 overflow-hidden rounded-md border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={draft.media_urls[0]} alt="" className="w-full object-cover" style={{ aspectRatio: "1.91 / 1" }} />
                </div>
              )}
            </div>
          </div>

          {/* Right: stats + details */}
          <div className="flex flex-col gap-4">
            {analytics?.is_stale && (
              <div className="rounded-md bg-warning-bg border border-warning-border px-3 py-2 text-xs text-warning-fg" data-testid="stale-banner">
                Metrics may be outdated — live data temporarily unavailable.
              </div>
            )}

            {/* Top metrics */}
            <div className="grid grid-cols-2 gap-2">
              <StatCard
                icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>}
                label="Impressions"
                value={formatNumber(analytics?.impressions)}
              />
              <StatCard
                icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z" /></svg>}
                label="Eng. rate"
                value={formatPercent(analytics?.engagement_rate)}
              />
            </div>

            {/* Per-platform engagement details */}
            <PlatformMetrics platform={platform} data={analytics ?? { impressions: null, engagement_rate: null, reactions: null, shares: null, comments: null, clicks: null, views: null, calls: null, directions: null, platform_specific: {}, fetched_at: "", is_stale: false }} />

            {/* Post info */}
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground bg-muted">Post info</div>
              <MetricRow icon={calendarIcon} label="Published" value={formatPublishedAt(draft?.published_at ?? null)} />
              {draft?.published_url && (
                <div className="flex items-center gap-2 px-3 py-2 border-t border-border">
                  <span className="text-muted-foreground shrink-0">{linkIcon}</span>
                  <span className="flex-1 text-sm text-muted-foreground">Post link</span>
                  <a
                    href={draft.published_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="max-w-[160px] truncate text-sm text-primary underline-offset-2 hover:underline"
                    data-testid="post-link"
                  >
                    {draft.published_url}
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          {/* Open post */}
          {draft?.published_url && (
            <a
              href={draft.published_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
              data-testid="open-post-btn"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              Open post
            </a>
          )}

          {/* More dropdown */}
          <div className="relative" ref={moreRef}>
            <button
              type="button"
              onClick={() => setMoreOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
              data-testid="more-btn"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
              </svg>
              More
            </button>
            {moreOpen && (
              <div
                role="menu"
                className="absolute bottom-full left-0 mb-1 w-40 rounded-lg border border-border bg-popover shadow-lg"
              >
                <div className="p-1">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setMoreOpen(false); void handleDuplicate(); }}
                    className="flex w-full items-center rounded-md px-2 py-1.5 text-sm hover:bg-muted text-left"
                    data-testid="duplicate-btn"
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setMoreOpen(false); handleCopyLink(); }}
                    className="flex w-full items-center rounded-md px-2 py-1.5 text-sm hover:bg-muted text-left"
                    data-testid="copy-link-btn"
                  >
                    Copy link
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setMoreOpen(false); void handleDelete(); }}
                    className="flex w-full items-center rounded-md px-2 py-1.5 text-sm hover:bg-muted text-left text-destructive"
                    data-testid="delete-btn"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Schedule again */}
          <button
            type="button"
            onClick={() => {
              if (draft) onScheduleAgain?.(draft);
              onClose();
            }}
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            data-testid="schedule-again-btn"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Schedule again
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
