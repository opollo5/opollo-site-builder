"use client";

import { useEffect, useRef, useState } from "react";
import { LightbulbIcon, ChevronUpIcon } from "lucide-react";

import { StatusPill } from "@/components/ui/status-pill";
import { EvidenceDetail } from "./EvidenceDetail";
import { DismissalModal } from "./DismissalModal";

interface Recommendation {
  id: string;
  recommendation_type: string;
  headline: string;
  body: string;
  confidence_band: "strong" | "moderate";
  confidence_score: number;
}

interface RecommendationsSidebarProps {
  companyId: string;
  platform?: string;
}

const MIN_POSTS = 20;

function SidebarSkeleton() {
  return (
    <div className="space-y-3" data-testid="sidebar-skeleton">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-lg bg-m2" />
      ))}
    </div>
  );
}

function SidebarEmptyState({ postCount }: { postCount: number | null }) {
  if (postCount !== null && postCount < MIN_POSTS) {
    return (
      <div className="text-center py-6" data-testid="sidebar-empty-need-more">
        <p className="text-sm text-tx-primary font-medium">
          Need {MIN_POSTS - postCount} more posts
        </p>
        <p className="text-sm text-tx-muted mt-1">
          Recommendations unlock at {MIN_POSTS} posts.
        </p>
      </div>
    );
  }
  return (
    <div className="text-center py-6" data-testid="sidebar-empty-none">
      <p className="text-sm text-tx-muted">
        No recommendations yet. We&apos;ll surface some after the next analysis run.
      </p>
    </div>
  );
}

interface CompactCardProps {
  rec: Recommendation;
  companyId: string;
  onDismissed: (id: string) => void;
}

function CompactCard({ rec, companyId, onDismissed }: CompactCardProps) {
  const [dismissOpen, setDismissOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  const pillKind = rec.confidence_band === "strong" ? "strong_signal" : "early_signal";
  const pillLabel = rec.confidence_band === "strong" ? "Strong signal" : "Early signal";

  async function handleDismiss(reason: string, notes: string) {
    const params = new URLSearchParams({ company_id: companyId });
    await fetch(`/api/insights/recommendations/${rec.id}/dismiss?${params}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, notes }),
    });
    setDismissOpen(false);
    onDismissed(rec.id);
  }

  return (
    <>
      <div
        className="rounded-lg border border-b2 p-3 hover:border-b3 transition-smooth relative"
        data-testid="sidebar-rec-card"
        data-rec-id={rec.id}
      >
        <button
          onClick={() => setDismissOpen(true)}
          className="absolute top-2 right-2 text-tx-muted hover:text-tx-primary transition-smooth"
          aria-label="Dismiss recommendation"
          data-testid="sidebar-dismiss-btn"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M18 6 6 18" /><path d="m6 6 12 12" />
          </svg>
        </button>
        <div className="flex items-center gap-2 mb-2 pr-5">
          <StatusPill kind={pillKind} label={pillLabel} />
        </div>
        <p className="text-sm font-medium text-tx-primary leading-snug">{rec.headline}</p>
        <button
          onClick={() => setEvidenceOpen(true)}
          className="text-sm text-pk hover:text-pk/80 mt-1 inline-flex items-center gap-1"
          data-testid="sidebar-see-evidence"
        >
          See evidence →
        </button>
      </div>

      <DismissalModal
        open={dismissOpen}
        onClose={() => setDismissOpen(false)}
        onConfirm={handleDismiss}
        headline={rec.headline}
      />
      <EvidenceDetail
        open={evidenceOpen}
        onClose={() => setEvidenceOpen(false)}
        recommendationId={rec.id}
        headline={rec.headline}
        companyId={companyId}
      />
    </>
  );
}

export function RecommendationsSidebar({
  companyId,
  platform = "",
}: RecommendationsSidebarProps) {
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [postCount, setPostCount] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    const params = new URLSearchParams({ company_id: companyId, limit: "5" });
    if (platform) params.set("platform", platform);
    fetch(`/api/insights/recommendations?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setRecs(d.recommendations ?? []);
          if (typeof d.postCount === "number") setPostCount(d.postCount);
        }
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        setLoaded(true);
      });
  }, [companyId, platform]);

  function handleDismissed(id: string) {
    setRecs((prev) => prev.filter((r) => r.id !== id));
  }

  if (collapsed) {
    return (
      <div
        className="hidden xl:flex w-16 shrink-0 border-l border-b1 flex-col items-center pt-4 gap-2 bg-bg-base"
        data-testid="sidebar-collapsed"
      >
        <button
          onClick={() => setCollapsed(false)}
          className="flex flex-col items-center gap-1 text-tx-muted hover:text-pk transition-smooth p-2 rounded-md hover:bg-m2"
          aria-label="Expand insights sidebar"
        >
          <LightbulbIcon className="h-5 w-5" />
          {recs.length > 0 && (
            <span className="text-sm font-semibold text-pk">{recs.length}</span>
          )}
        </button>
      </div>
    );
  }

  return (
    <aside
      className="hidden xl:flex w-80 shrink-0 border-l border-b1 flex-col bg-bg-base overflow-y-auto"
      data-testid="insights-sidebar"
    >
      <header className="flex items-center justify-between border-b border-b1 px-4 py-3">
        <h2 className="text-base font-semibold text-tx-primary flex items-center gap-2">
          <LightbulbIcon className="h-4 w-4 text-pk" aria-hidden />
          Suggestions for this post
        </h2>
      </header>

      <div className="flex-1 p-4 space-y-3">
        {loading && <SidebarSkeleton />}

        {!loading && loaded && recs.length === 0 && (
          <SidebarEmptyState postCount={postCount} />
        )}

        {!loading && recs.length > 0 && (
          <>
            <p className="text-sm text-tx-muted">Based on your recent posts:</p>
            {recs.map((rec) => (
              <CompactCard
                key={rec.id}
                rec={rec}
                companyId={companyId}
                onDismissed={handleDismissed}
              />
            ))}
          </>
        )}
      </div>

      <footer className="border-t border-b1 px-4 py-3">
        <button
          onClick={() => setCollapsed(true)}
          className="flex items-center gap-1.5 text-sm text-tx-muted hover:text-tx-primary transition-smooth"
          data-testid="sidebar-collapse-btn"
        >
          <ChevronUpIcon className="h-4 w-4" aria-hidden />
          Collapse
        </button>
      </footer>
    </aside>
  );
}
