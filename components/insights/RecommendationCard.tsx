"use client";

import { useState } from "react";
import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { DismissalModal } from "./DismissalModal";
import { EvidenceDetail } from "./EvidenceDetail";

interface Recommendation {
  id: string;
  recommendation_type: string;
  headline: string;
  body: string;
  confidence_band: "strong" | "moderate";
  confidence_score: number;
}

interface RecommendationCardProps {
  rec: Recommendation;
  companyId: string;
  onDismissed: (id: string) => void;
}

export function RecommendationCard({ rec, companyId, onDismissed }: RecommendationCardProps) {
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
      <Card
        className="border-b2 relative"
        data-testid="recommendation-card"
        data-rec-id={rec.id}
      >
        <CardContent className="pt-4 pr-10">
          <div className="flex items-center gap-2 mb-2">
            <StatusPill kind={pillKind} label={pillLabel} />
          </div>
          <p className="text-base text-tx-primary font-medium leading-snug">{rec.headline}</p>
          <p className="text-sm text-tx-secondary mt-1">{rec.body}</p>
          <button
            onClick={() => setEvidenceOpen(true)}
            className="text-sm text-pk hover:text-pk/80 mt-2 inline-flex items-center gap-1"
            data-testid="see-evidence"
          >
            See evidence →
          </button>
        </CardContent>
        <button
          onClick={() => setDismissOpen(true)}
          className="absolute top-3 right-3 text-tx-muted hover:text-tx-primary transition-colors"
          aria-label="Dismiss recommendation"
          data-testid="dismiss-button"
        >
          <XIcon size={16} />
        </button>
      </Card>

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
