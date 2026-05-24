"use client";

import { useEffect, useState } from "react";
import { ExternalLinkIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusPill } from "@/components/ui/status-pill";

interface EvidenceRow {
  id: string;
  source_table: string;
  source_row_ref: string;
  summary: string;
}

interface EvidenceDetailProps {
  open: boolean;
  onClose: () => void;
  recommendationId: string;
  headline: string;
  companyId: string;
}

export function EvidenceDetail({
  open,
  onClose,
  recommendationId,
  headline,
  companyId,
}: EvidenceDetailProps) {
  const [evidence, setEvidence] = useState<EvidenceRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !recommendationId) return;
    setLoading(true);
    fetch(
      `/api/insights/recommendations/${recommendationId}/evidence?company_id=${encodeURIComponent(companyId)}`,
    )
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setEvidence(d.evidence ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, recommendationId, companyId]);

  return (
    <Dialog open={open} onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent className="max-w-md" data-testid="evidence-sheet">
        <DialogHeader>
          <DialogTitle className="text-tx-primary pr-6">{headline}</DialogTitle>
        </DialogHeader>

        <div className="mt-2 space-y-3">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-m2" />
              ))}
            </div>
          ) : evidence.length === 0 ? (
            <p className="text-sm text-tx-muted">No evidence rows found.</p>
          ) : (
            evidence.map((ev) => (
              <div
                key={ev.id}
                className="rounded-lg border border-b2 p-3 space-y-1"
                data-testid="evidence-row"
              >
                <div className="flex items-center gap-2">
                  <StatusPill
                    kind={ev.source_table === "ins_post_features" ? "client_green" : "client_amber"}
                    label={ev.source_table === "ins_post_features" ? "Post feature" : "Analytics"}
                  />
                  {ev.source_row_ref && (
                    <a
                      href={`/company/social/posts/${ev.source_row_ref}`}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto text-pk hover:text-pk/80"
                    >
                      <ExternalLinkIcon size={14} />
                    </a>
                  )}
                </div>
                <p className="text-sm text-tx-secondary">{ev.summary}</p>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
